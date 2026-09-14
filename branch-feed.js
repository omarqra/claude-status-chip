// Feeds live git branches to the patched webview.
//
// Claude 2.1.270 removed the exec RPC the chip used to run `git symbolic-ref`, and the panel's
// CSP is `default-src 'none'` with no connect-src -- so from inside the webview there is no way
// left to ask git anything, or to fetch a file. What the CSP does allow is `style-src` from the
// Claude extension's own folder. So this side (a normal Node extension host, no such limits)
// parks the branches in a tiny stylesheet there as a custom property, and the chip's runtime
// reads them back with getComputedStyle. One CSS custom property, refreshed every few seconds.
//
// Everything here is plain file reads -- .git/HEAD and .git/worktrees/*/HEAD -- so polling a few
// times a minute costs nothing and no git process is ever spawned.
const fs = require("fs");
const path = require("path");
const os = require("os");

const CSS_FILE = "cc-status-branch.css";
const PROP = "--cc-branches";
const MAX_ENTRIES = 40;

function webviewDir() {
  const root = path.join(os.homedir(), ".vscode", "extensions");
  let best = null;
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return null; }
  for (const d of entries) {
    const m = d.match(/^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)/);
    if (!m) continue;
    const dir = path.join(root, d, "webview");
    if (!fs.existsSync(path.join(dir, "index.js"))) continue;
    const v = [+m[1], +m[2], +m[3]];
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) best = { dir, v };
  }
  return best && best.dir;
}

// "ref: refs/heads/feature/x" -> "feature/x"; a detached HEAD gives the short sha
function headBranch(gitDir) {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : head.slice(0, 7);
  } catch { return ""; }
}

function repoRoot(dir) {
  let cur = path.resolve(dir);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
  return null;
}

// [[worktreePath, branch], ...] for the repo containing `dir` -- the main worktree plus every
// linked one, since sessions in sibling worktrees each need their own branch.
function branchesFor(dir) {
  const root = repoRoot(dir);
  if (!root) return [];
  const dotGit = path.join(root, ".git");
  const out = [];
  let common = dotGit;
  try {
    if (fs.statSync(dotGit).isFile()) {
      // `dir` is itself a linked worktree: ".git" is a file pointing at <common>/worktrees/<name>
      const gitdir = fs.readFileSync(dotGit, "utf8").replace(/^gitdir:\s*/, "").trim();
      out.push([root, headBranch(gitdir)]);
      common = path.resolve(gitdir, "..", "..");
    } else {
      out.push([root, headBranch(dotGit)]);
    }
  } catch { return out; }

  // started from a linked worktree: the main one is still a place sessions run, so include it
  if (common !== dotGit) {
    const mainRoot = path.dirname(common);
    const b = headBranch(common);
    if (b && !out.some(([p]) => p === mainRoot)) out.push([mainRoot, b]);
  }

  const wtRoot = path.join(common, "worktrees");
  let names = [];
  try { names = fs.readdirSync(wtRoot); } catch { return out; }
  for (const name of names) {
    const d = path.join(wtRoot, name);
    try {
      // this file holds "<worktree>/.git", so its directory is the worktree itself
      const wt = path.dirname(fs.readFileSync(path.join(d, "gitdir"), "utf8").trim());
      const b = headBranch(d);
      if (wt && b && !out.some(([p]) => p === wt)) out.push([wt, b]);
    } catch {}
  }
  return out;
}

const enc = (s) => encodeURIComponent(s);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function parse(css) {
  const m = css && css.match(/--cc-branches:\s*"([^"]*)"/);
  if (!m || !m[1]) return [];
  return m[1].split(",").map((p) => p.split("|")).filter((kv) => kv.length === 2).map(([k, v]) => [dec(k), dec(v)]);
}

function render(entries) {
  const body = entries.slice(0, MAX_ENTRIES).map(([p, b]) => `${enc(p)}|${enc(b)}`).join(",");
  return `:root{${PROP}:"${body}"}\n`;
}

// Other VSCode windows write the same file for their own folders, so merge rather than
// overwrite: ours win, theirs are kept, and each window refreshes its own within seconds.
function merge(existing, mine) {
  const out = mine.slice();
  for (const [p, b] of existing) if (!out.some(([q]) => q === p)) out.push([p, b]);
  return out;
}

function writeOnce(dirs) {
  const dir = webviewDir();
  if (!dir) return { status: "none" };
  const mine = [];
  for (const d of dirs || []) for (const e of branchesFor(d)) if (!mine.some(([p]) => p === e[0])) mine.push(e);

  const file = path.join(dir, CSS_FILE);
  let existing = [];
  try { existing = parse(fs.readFileSync(file, "utf8")); } catch {}
  const css = render(merge(existing, mine));
  let current = null;
  try { current = fs.readFileSync(file, "utf8"); } catch {}
  if (current === css) return { status: "unchanged", file };
  try { fs.writeFileSync(file, css); } catch (e) { return { status: "error", message: String((e && e.message) || e) }; }
  return { status: "written", file, count: mine.length };
}

// `getDirs` is read on every tick so opening a folder or switching worktrees is picked up
// without restarting anything.
function start(getDirs, intervalMs) {
  const tick = () => { try { writeOnce(getDirs()); } catch {} };
  tick();
  const timer = setInterval(tick, intervalMs || 4000);
  return () => clearInterval(timer);
}

module.exports = { start, writeOnce, branchesFor, CSS_FILE };
