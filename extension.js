// Claude Status Chip — keeps a status-chip patch applied to the Claude Code
// VSCode extension's webview across its auto-updates, and feeds it the live git
// branch, which the webview itself is no longer allowed to look up (branch-feed.js).
// The patch logic lives in patch-core.js (bundled). If the user keeps an
// editable copy at ~/.claude/patch-claude-vscode-status.js, that one wins so
// power users can tweak the chip without reinstalling this extension.
const path = require("path");
const os = require("os");
const fs = require("fs");
const vscode = require("vscode");
const branchFeed = require("./branch-feed.js");

const CANDIDATES = [
  path.join(os.homedir(), ".claude", "patch-claude-vscode-status.js"),
  path.join(__dirname, "patch-core.js"),
];

function resolvePatcher() {
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function runPatch() {
  const target = resolvePatcher();
  if (!target) return { status: "error", message: "no patcher found" };
  try {
    // always re-read from disk so edits take effect without restarting VSCode
    delete require.cache[require.resolve(target)];
    const mod = require(target);
    if (mod && typeof mod.run === "function") return mod.run();
    return { status: "error", message: "patcher exports no run()" };
  } catch (e) {
    return { status: "error", message: String((e && e.message) || e) };
  }
}

function notifyReload(message) {
  vscode.window.showInformationMessage(message, "Reload Window").then((sel) => {
    if (sel === "Reload Window") vscode.commands.executeCommand("workbench.action.reloadWindow");
  });
}

function handle(res, { silentAlready }) {
  if (!res) return;
  if (res.status === "patched") {
    notifyReload("Claude status chip applied. Reload the window to activate it.");
  } else if (res.status === "anchor-missing" && !silentAlready) {
    vscode.window.showWarningMessage("Claude status chip: patch anchor not found in this Claude extension version — the patcher needs updating.");
  }
}

function activate(context) {
  handle(runPatch(), { silentAlready: false });
  // self-heal: catches Claude extension auto-updates that land while VSCode runs,
  // and any other patcher rewriting the bundle over ours
  const timer = setInterval(() => handle(runPatch(), { silentAlready: true }), 60000);
  // the panel can no longer run git itself, so publish the branches from out here where we
  // still can -- read fresh every tick, so opening a folder needs no restart
  const stopFeed = branchFeed.start(
    () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    4000,
  );
  context.subscriptions.push({ dispose: () => { clearInterval(timer); stopFeed(); } });
}

function deactivate() {}

module.exports = { activate, deactivate };
