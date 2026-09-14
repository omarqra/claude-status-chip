# Claude Status Chip

[![Open VSX](https://img.shields.io/open-vsx/v/omarkara/claude-status-chip?label=Open%20VSX&color=14657a)](https://open-vsx.org/extension/omarkara/claude-status-chip)
[![Installs](https://img.shields.io/open-vsx/dt/omarkara/claude-status-chip?label=installs&color=14657a)](https://open-vsx.org/extension/omarkara/claude-status-chip)
[![License: MIT](https://img.shields.io/badge/license-MIT-14657a)](LICENSE)

> **Unofficial community extension** — not affiliated with or endorsed by Anthropic. It locally
> patches the installed Claude Code extension's webview (a backup is kept; see caveats below).

Adds an always-visible, colored status chip to the **Claude Code** panel's input toolbar (next to the
`/` button):

![The status chip in the Claude Code panel: model, branch, context usage, effort and cost pills next to the input box](screenshot.png)

```
⚙ [(main)] [487k/1M (49%)] [think] [$12.35]
```

- **Git branch**, live — updates within seconds of a checkout (purple), per worktree
- **Context usage** as `used/window (%)` — the pill fills like a progress bar and turns
  green → yellow (≥50%) → red (≥80%)
- **think** indicator when extended thinking is on (orange) — Claude surfaces this nowhere else,
  it's buried in the command menu
- **Session cost** when the API reports one (yellow)
- **⚙ gear menu**: show/hide any item + zoom the conversation transcript only (80%–160%) —
  the panel header and input box stay at normal size. Preferences persist.

It merges into Claude's toolbar rather than crowding it: Claude's own model pill is restyled to
match the chip (and still opens the model switcher), the chip carries nothing Claude already shows
— its pill spells out the model and effort level itself — and when the panel gets too narrow for
one row the chip moves to its own row underneath. Claude's toolbar then measures and lays itself
out exactly as it would without the extension, instead of collapsing its buttons to icons.

Claude's panel is not allowed to run git or fetch anything (its webview runs under
`default-src 'none'`), so from 1.2.0 the extension publishes the branches from the editor side —
reading `.git/HEAD` directly, no git process — and the chip reads them back. Sessions running in
different worktrees of one repo each show their own branch.

## Why this exists

Claude Code's `statusLine` setting only works in the terminal TUI — the VSCode panel never runs it,
and the panel's built-in context indicator stays hidden until less than 50% of context remains.
This extension patches the Claude Code extension's webview bundle to add the chip, and re-applies
the patch automatically after every Claude extension auto-update (checks at startup and every 60s,
then offers a one-click window reload).

## Install

**Marketplace: [Open VSX Registry](https://open-vsx.org/extension/omarkara/claude-status-chip)**

### VSCodium, Cursor, Windsurf, Gitpod, Eclipse Theia

These editors read Open VSX directly. Extensions view → search **Claude Status Chip** → Install.

### Stock VS Code

Stock VS Code reads Microsoft's marketplace, where this extension is not published. Grab the `.vsix`
from Open VSX and install it manually:

```
curl -LO https://open-vsx.org/api/omarkara/claude-status-chip/1.3.0/file/omarkara.claude-status-chip-1.3.0.vsix
code --install-extension omarkara.claude-status-chip-1.1.3.vsix
```

Or: Extensions view → `⋯` → **Install from VSIX…** and pick the downloaded file.

Restart VSCode once. When the notification appears, click **Reload Window**.

## Notes / caveats

- This modifies the installed Claude Code extension's `webview/index.js` **locally** (a backup is kept
  as `index.js.cc-status.bak` next to it). Unofficial — use at your own risk.
- If a future Claude version restructures its bundle, you'll get a warning ("patch anchor not found")
  instead of a broken panel; the patch logic then needs an update.
- Power users: drop an edited copy of the patcher at `~/.claude/patch-claude-vscode-status.js` — it
  takes precedence over the bundled one, so you can customize the chip without reinstalling.
- To uninstall cleanly: uninstall this extension, then restore the `.cc-status.bak` backup (or simply
  reinstall/update the Claude Code extension).

## Author

**Omar Kara Mohammed** — full-stack and mobile developer, AI-native product builder. I build
software with AI, ship it, and run the infrastructure under it.

- LinkedIn: [linkedin.com/in/omarkm2021](https://www.linkedin.com/in/omarkm2021)
- X: [@Omar449153](https://x.com/Omar449153)
- GitHub: [github.com/omarqra](https://github.com/omarqra)

Found it useful? A ⭐ on the repo or a rating on
[Open VSX](https://open-vsx.org/extension/omarkara/claude-status-chip) helps other Claude Code users
find it. Issues and PRs welcome.

## License

MIT — see [LICENSE](LICENSE).
