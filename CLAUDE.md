# claude-status-chip

A VSCode extension that patches the **installed Claude Code extension's webview bundle**
(`~/.vscode/extensions/anthropic.claude-code-<version>/webview/index.js`) to inject a status chip.
All the real logic is in `patch-core.js`; `extension.js` only runs it at startup and every 60s so
the patch survives Claude's auto-updates.

## The patcher has two copies — sync them

`extension.js` prefers `~/.claude/patch-claude-vscode-status.js` over the bundled `patch-core.js`.
After editing the repo copy: `cp patch-core.js ~/.claude/patch-claude-vscode-status.js`, or the
running extension keeps using the old logic.

## Anchors into the minified bundle

- Identifiers are `[\w$]+`, never `\w+` — the minifier hands out bare `$` and `$J` names.
- **Match the head of an expression, not its tail.** 2.1.261 changed `children:e0` to
  `children:D(wW1,{...})` inside the model-pill row and the old tail-matching anchor silently
  stopped matching. Insert *ahead* of a matched head instead of after a full expression.
- Skip volatile middles wholesale (`contextWindow:[^{}]*?buttonClassName:`) so reordered or
  renamed props can't break a match.
- Class names carry per-build hashes (`messagesContainer_a1b2c3`); select on the stable prefix
  (`[class*=modelPill_]`) and check the substring can't also match a sibling (`modelPillRow_`).
- Claude also *reuses* its pill class for new controls (2.1.270's agents pill is a `modelPill`),
  so scope anything that colours or brands a control by semantics as well — the model switcher is
  the one with `[role=combobox]`. Geometry can stay shared; identity must not.

- **Never reference a captured identifier by name inside injected code.** Pass the jsx factory and
  the session store into the chip's IIFE as parameters. 2.1.270 minified the jsx factory to `F`,
  our number formatter is `var F=...`, and the chip silently rendered the literal text `span`.

## Two injection points

1. **Inline** — after the built-in usage button in the input footer. Required; a miss returns
   `anchor-missing` and the extension warns the user.
2. **Own row** — ahead of Claude's `M===2&&<modelPillRow>` fragment slot. Optional: if it doesn't
   match, the chip stays inline (older behaviour) rather than failing the whole patch. **This one
   fails silently, so verify it after every Claude update.**

The inline copy leaves a builder on `window.__ccStatus.__mk` and the row copy calls it, which works
because array children evaluate in source order.

## Claude's footer measures itself — stay out of its way

The footer sums its children's widths and escalates `data-fit-stage` 0 → 1 (hide button labels) →
2 (drop the model pill to a second row); it only ever skips children whose computed `position` is
`absolute`. So the chip's own-row mode hides the inline copy (`display:none`, width 0), which takes
it out of that sum, then pokes the footer with a synchronous add+remove of a throwaway node to
force a re-measure (the footer's MutationObserver watches childList/characterData, not attributes).

## Segments Claude already shows go default-off, not deleted

`DEF` in the runtime holds them; they stay toggleable from the gear menu. Currently `model` and
`effort` (Claude's model pill reads `Opus 5  xhigh`, and 2.1.261 also puts the level on the input
box border). `think` stays on — Claude surfaces it nowhere outside the command menu.

## The webview is sandboxed — the branch comes from outside

2.1.270 removed `connection.exec`, and the panel's CSP is `default-src 'none'` with no
`connect-src`, so injected code can neither run git nor fetch a file. The one channel left is
`style-src <extension folder>`: `branch-feed.js` (extension host, no such limits) reads `.git/HEAD`
and every `.git/worktrees/*/HEAD` and writes them into `cc-status-branch.css` next to Claude's
bundle as a `--cc-branches` custom property; the runtime re-points a `<link>` at it every 5s and
reads it back with `getComputedStyle`, then feeds the session's own `gitBranch` signal so React
re-renders. Sessions are matched to a branch by longest path prefix of their `cwd`, which is what
makes per-worktree branches work. Other windows write the same file, so writes merge, never clobber.

**`patch-core.js` alone is not enough any more.** A user on an old installed version but a fresh
`~/.claude/patch-claude-vscode-status.js` gets a chip that looks for a feed nobody writes; the
branch just stays empty, which is the intended degradation.

## Testing a re-patch locally

```bash
cd ~/.vscode/extensions/anthropic.claude-code-<newest>/webview
n=$(grep -n "RTL Toggle Button - Added by script" index.js | cut -d: -f1)  # user's own script
sed -n "${n},\$p" index.js > /tmp/rtl.js                                   # keep it, it isn't ours
cp index.js.cc-status.bak index.js                                         # pristine
node /path/to/patch-core.js && printf '\n' >> index.js && cat /tmp/rtl.js >> index.js
node --check index.js
```

- **Verify it renders, not just that it applied.** `node --check` and marker counts both pass for
  a chip that draws the wrong thing (see the `span` bug above) — after a Claude update, look at the
  panel, or ask the user for a screenshot, before calling it done or shipping a release.
- `run()` no-ops when the marker is present, so a stale patch must be undone by restoring the
  backup first.
- Count matches with `grep -o -F 'pat' index.js | wc -l`. `grep -c` counts *lines*, and the bundle
  is essentially one line, so it reports 1 for everything.
- Multiple Claude versions can sit side by side; `findExtension()` targets the highest.

## Release

Bump `package.json` and the two `.vsix` URLs in README, then:

```bash
npx --yes @vscode/vsce@latest package
git tag -a vX.Y.Z -m "..." && git push origin main --follow-tags
gh release create vX.Y.Z claude-status-chip-X.Y.Z.vsix --title "..." --notes "..."
set -a; . ./.env; set +a; npx --yes ovsx publish claude-status-chip-X.Y.Z.vsix
```

`.env` (git-ignored, see `.env.example`) holds `OVSX_PAT`; `ovsx` reads it from the environment, so
the token never reaches a command line. Open VSX takes 1–2 minutes to surface a new version after
the publish command reports success — poll `https://open-vsx.org/api/omarkara/claude-status-chip`
before reporting it live. Not published to Microsoft's marketplace.
