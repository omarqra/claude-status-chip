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

## Testing a re-patch locally

```bash
cd ~/.vscode/extensions/anthropic.claude-code-<newest>/webview
n=$(grep -n "RTL Toggle Button - Added by script" index.js | cut -d: -f1)  # user's own script
sed -n "${n},\$p" index.js > /tmp/rtl.js                                   # keep it, it isn't ours
cp index.js.cc-status.bak index.js                                         # pristine
node /path/to/patch-core.js && printf '\n' >> index.js && cat /tmp/rtl.js >> index.js
node --check index.js
```

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
