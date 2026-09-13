#!/usr/bin/env node
// Injects an always-visible status chip (model · branch · context tokens/window (%) · effort · think · cost)
// plus a gear (settings) button into the Claude Code VSCode extension's input toolbar (webview).
// Segments render as theme-aware colored pills (--vscode-charts-* variables + color-mix backgrounds);
// the context pill's background fills proportionally to usage. The gear opens a popup with per-segment
// show/hide toggles and transcript-only zoom +/- controls; preferences persist in the webview's
// localStorage ("cc-status-prefs").
// Idempotent: re-run any time; it no-ops when the current extension version is already patched.
// A backup of the original bundle is kept next to it as index.js.cc-status.bak.
//
// Used two ways:
//   CLI:    node patch-claude-vscode-status.js          (SessionStart hook does this)
//   module: require(...).run()                          (the cc-status-patcher companion VSCode
//                                                        extension calls this on startup + every 60s)
const fs = require("fs");
const path = require("path");
const os = require("os");

const MARKER = "cc-status-chip";
// Default transcript zoom when the user hasn't picked one from the gear menu yet. 1 = off.
// (Gear-menu changes persist in the webview's localStorage and override this default.)
const ZOOM = 1.15;

function findExtension() {
  const roots = [path.join(os.homedir(), ".vscode", "extensions")];
  const found = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const d of entries) {
      const m = d.match(/^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)/);
      if (!m) continue;
      const file = path.join(root, d, "webview", "index.js");
      if (fs.existsSync(file)) found.push({ file, v: [+m[1], +m[2], +m[3]] });
    }
  }
  found.sort((a, b) => a.v[0] - b.v[0] || a.v[1] - b.v[1] || a.v[2] - b.v[2]);
  return found.pop();
}

// Anchor: the render call of the built-in context-usage button in the input footer:
//   j(c90,{usedTokens:$.usageData.value.totalTokens,contextWindow:...,onCompact:z,buttonClassName:$J.usageButtonV2})
// g1 = minified jsx fn, g2 = component, g3 = session store var. Minified names change per build,
// so everything is captured rather than hardcoded. Identifiers are [\w$], not \w: the minifier hands
// out bare "$" and "$J" names, which is exactly what broke this on Claude 2.1.245. Everything between
// contextWindow: and buttonClassName: is skipped wholesale, so a renamed or reordered onCompact prop
// can't break the match either.
const re = /([\w$]+)\(([\w$]+),\{usedTokens:([\w$]+)\.usageData\.value\.totalTokens,contextWindow:[^{}]*?buttonClassName:[\w$]+\.usageButtonV2\}\)/;

// ---------------------------------------------------------------------------
// Runtime support, appended once at the end of the bundle: prefs store,
// zoom + visibility CSS appliers, and the gear popup (plain DOM — no React
// hooks, whose minified names we can't rely on).
// ---------------------------------------------------------------------------
const runtime = [
  ';(function(){try{',
  'var K="cc-status-prefs";',
  'function load(){try{return JSON.parse(localStorage.getItem(K))||{}}catch(_){return{}}}',
  'function save(p){try{localStorage.setItem(K,JSON.stringify(p))}catch(_){}}',
  'function styleEl(id){var el=document.getElementById(id);if(!el){el=document.createElement("style");el.id=id;(document.head||document.documentElement).appendChild(el)}return el}',
  // [key, menu label, dot color] — dot colors mirror the chip pill colors
  'var SEGS=[["model","Model","var(--vscode-charts-blue,#4fc1ff)"],["branch","Branch","var(--vscode-charts-purple,#b180d7)"],["ctx","Context usage","var(--vscode-charts-green,#89d185)"],["effort","Effort","var(--vscode-charts-yellow,#cca700)"],["think","Thinking","var(--vscode-charts-orange,#d18616)"],["cost","Cost","var(--vscode-charts-yellow,#cca700)"]];',
  'var api=window.__ccStatus={};',
  // Segments Claude's own UI already shows, so ours would only duplicate them. They ship
  // off and stay available in the gear menu:
  //   model  — its footer gained a clickable model pill (2.1.25x)
  //   effort — that pill now carries the level too ("Opus 5  xhigh"), and 2.1.261 also put
  //            it on the input box border, spelled out for 3s after every change
  // Thinking stays on: Claude surfaces it nowhere, only inside the command menu.
  'var DEF={model:false,effort:false};',
  'api.visible=function(k){var v=api.prefs[k];return v===undefined?DEF[k]!==false:v!==false};',
  'api.prefs=load();',
  `api.zoom=function(){var z=api.prefs.zoom;return typeof z==="number"&&z>=0.8&&z<=1.6?z:${ZOOM}};`,
  // zoom the conversation text only — not the header or the input box. The hash suffix of
  // messagesContainer_<hash> changes per build, so match on the stable semantic prefix.
  'api.applyZoom=function(){styleEl("cc-zoom").textContent=api.zoom()===1?"":"[class*=messagesContainer_]{zoom:"+api.zoom()+"}"};',
  'api.applyCss=function(){var css="";for(var i=0;i<SEGS.length;i++){var k=SEGS[i][0];if(!api.visible(k))css+=".cc-status-chip [data-seg="+k+"]{display:none}"}styleEl("cc-status-style").textContent=css};',
  'api.set=function(k,v){api.prefs[k]=v;save(api.prefs);api.applyCss()};',
  'api.setZoom=function(z){api.prefs.zoom=z;save(api.prefs);api.applyZoom()};',
  'api.openMenu=function(ev){',
  'var old=document.getElementById("cc-status-menu");if(old){old.remove();return}',
  'var btn=ev&&ev.currentTarget;',
  'var mnu=document.createElement("div");mnu.id="cc-status-menu";',
  'mnu.style.cssText="position:fixed;z-index:100000;min-width:200px;padding:10px;border-radius:10px;font-size:12px;direction:ltr;background:var(--vscode-editorWidget-background,#252526);color:var(--vscode-foreground,#ccc);border:1px solid var(--vscode-widget-border,#454545);box-shadow:0 6px 24px rgba(0,0,0,.4)";',
  'var h=document.createElement("div");h.textContent="Status bar";h.style.cssText="font-weight:600;margin:0 6px 6px;opacity:.75;font-size:11px;text-transform:uppercase;letter-spacing:.4px";mnu.appendChild(h);',
  'SEGS.forEach(function(s){var lab=document.createElement("label");',
  'var c=document.createElement("input");c.type="checkbox";c.checked=api.visible(s[0]);c.onchange=function(){api.set(s[0],c.checked)};lab.appendChild(c);',
  'var dot=document.createElement("span");dot.style.cssText="width:8px;height:8px;border-radius:999px;flex:none;background:"+s[2];lab.appendChild(dot);',
  'lab.appendChild(document.createTextNode(s[1]));mnu.appendChild(lab)});',
  'var zr=document.createElement("div");zr.style.cssText="display:flex;align-items:center;gap:8px;margin:8px 6px 0;padding-top:10px;border-top:1px solid var(--vscode-widget-border,#454545)";',
  'var zl=document.createElement("span");zl.textContent="Zoom";zl.style.cssText="opacity:.75;flex:1";zr.appendChild(zl);',
  'var zv=document.createElement("span");zv.style.cssText="min-width:40px;text-align:center;font-variant-numeric:tabular-nums";',
  'function zb(t,d){var b=document.createElement("button");b.type="button";b.className="cc-zbtn";b.textContent=t;b.title=d>0?"Zoom in":"Zoom out";b.onclick=function(){var nz=Math.round(Math.min(1.6,Math.max(0.8,api.zoom()+d))*100)/100;api.setZoom(nz);zv.textContent=Math.round(nz*100)+"%"};return b}',
  'zv.textContent=Math.round(api.zoom()*100)+"%";',
  'zr.appendChild(zb("-",-0.05));zr.appendChild(zv);zr.appendChild(zb("+",0.05));mnu.appendChild(zr);',
  'document.body.appendChild(mnu);',
  // position above the gear button (menu and footer live outside the zoomed transcript,
  // so no zoom coordinate correction is needed)
  'var r=btn?btn.getBoundingClientRect():{left:20,top:innerHeight-60};',
  'mnu.style.left=Math.max(8,r.left-170)+"px";',
  'mnu.style.bottom=(innerHeight-r.top+8)+"px";',
  'setTimeout(function(){function close(e2){if(!mnu.contains(e2.target)){mnu.remove();document.removeEventListener("mousedown",close)}}document.addEventListener("mousedown",close)},0);',
  '};',
  // static styles: menu rows/hover, themed checkboxes, zoom buttons, gear hover spin
  'styleEl("cc-menu-style").textContent="#cc-status-menu label{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;cursor:pointer}#cc-status-menu label:hover{background:var(--vscode-list-hoverBackground,rgba(128,128,128,.12))}#cc-status-menu input[type=checkbox]{accent-color:var(--vscode-button-background,#0e639c);margin:0}#cc-status-menu .cc-zbtn{width:24px;height:24px;cursor:pointer;border-radius:5px;border:1px solid var(--vscode-widget-border,#454545);background:var(--vscode-button-secondaryBackground,#3a3d41);color:inherit;font-size:13px;line-height:1}#cc-status-menu .cc-zbtn:hover{background:var(--vscode-button-secondaryHoverBackground,#45494e)}.cc-status-chip .cc-gear{transition:transform .15s ease,opacity .15s ease}.cc-status-chip .cc-gear:hover{opacity:1;transform:rotate(45deg)}";',
  // --- merge with Claude's own input footer (2.1.25x) -------------------------
  // Claude's footer now carries its own clickable model pill, and it measures its
  // children: when they overrun the row it hides button labels (fit stage 1) and
  // then drops the model pill onto a second row (stage 2). So: restyle that pill
  // to our pill shape (one continuous strip), and when the footer runs out of room
  // move our chip to its own row -- the inline copy goes display:none, which takes
  // our width out of Claude's measurement, and the footer lays out natively again.
  'var BLU="var(--vscode-charts-blue,#4fc1ff)";',
  // Geometry goes to every pill sharing Claude's pill class -- the model switcher, and the
  // agents pill 2.1.270 added next to it -- so the row keeps one height.
  'var MCSS="[class*=modelPill_]{min-height:0;height:18px;margin-left:0;padding:1px 8px;font-size:11px;line-height:16px;border-radius:999px;align-self:center}"',
  // The chip's model colour goes to the model switcher only: the agents pill is a different
  // thing and painting it blue would read as a second model. role=combobox separates them.
  '+"[class*=modelPill_][role=combobox]{color:"+BLU+";background:color-mix(in srgb, "+BLU+" 12%, transparent)}"',
  '+"[class*=modelPill_][role=combobox]:hover{background:color-mix(in srgb, "+BLU+" 22%, transparent)}"',
  '+".cc-status-chip.cc-row{display:none!important}"',
  '+"body.cc-rowmode .cc-status-chip.cc-row{display:flex!important}"',
  '+"body.cc-rowmode .cc-status-chip.cc-inline{display:none!important}";',
  'styleEl("cc-merge-style").textContent=MCSS;',
  // Nudge Claude's footer into re-measuring: it watches its subtree for childList
  // changes, and a CSS-only visibility flip wouldn't wake it. The node is added and
  // removed synchronously, so React never sees it.
  'function poke(ft){try{var d=document.createElement("span");d.style.display="none";ft.appendChild(d);ft.removeChild(d)}catch(_){}}',
  // Inline <-> own-row switch, driven by Claude's own overflow verdict (data-fit-stage)
  // rather than by width math of ours. Going back inline needs the footer to grow well
  // past the width we bailed at, so a panel parked at the threshold can not oscillate.
  'var st={mode:"inline",bail:0};',
  'api.fit=function(){try{',
  'var inl=document.querySelector(".cc-status-chip.cc-inline");',
  'if(!inl||!document.querySelector(".cc-status-chip.cc-row"))return;',
  'var ft=inl.parentElement;if(!ft)return;',
  'var w=ft.clientWidth||0,stage=+(ft.getAttribute("data-fit-stage")||0);',
  'if(st.mode==="inline"){if(stage>=1){st.mode="row";st.bail=w;document.body.classList.add("cc-rowmode");poke(ft)}}',
  'else if(w>st.bail+64){st.mode="inline";document.body.classList.remove("cc-rowmode");poke(ft)}',
  '}catch(_){}};',
  'setInterval(api.fit,700);',
  'api.applyZoom();api.applyCss();',
  '}catch(_){}})();',
].join("\n");

// ---------------------------------------------------------------------------
// The chip element. Rendered twice by the same component: inline in the input
// footer (right after the built-in usage button) and again as an extra row under
// the footer. Only one is visible at a time -- api.fit in the runtime hides the
// inline copy when Claude's footer runs out of room, which also takes our width
// out of Claude's own fit measurement so its toolbar lays out natively again.
// The pills are built once and shared by both copies (A.__mk below).
// Segments carry data-seg attributes; visibility is pure CSS (see runtime), so
// toggling needs no React re-render. The gear button always renders.
// ---------------------------------------------------------------------------
const chip = (jsx, sess) => `,(function(){` +
  // live branch detection: poll `git symbolic-ref` via the host's exec RPC and feed the
  // session's own gitBranch signal, so the chip (and session list) update on branch switch.
  // One interval per session store; the webview dies with the panel, so no cleanup needed.
  `if(!${sess}.__ccBrPoll){var pf=function(){try{` +
  `var cn=${sess}.connection&&${sess}.connection.value;` +
  `if(cn&&cn.exec)cn.exec("git",["symbolic-ref","--short","HEAD"]).then(function(r){` +
  `var b=(r&&r.stdout||"").trim();` +
  `if(b&&${sess}.gitBranch&&${sess}.gitBranch.value!==b)${sess}.gitBranch.value=b` +
  `}).catch(function(){})` +
  `}catch(_){}};pf();${sess}.__ccBrPoll=setInterval(pf,15000);}` +
  `var U=${sess}.usageData.value,` +
  `Mv=(${sess}.currentMainLoopModel&&${sess}.currentMainLoopModel.value)||"",` +
  // session store records the git branch (worktree branch wins for --worktree sessions)
  `BR=(${sess}.gitBranch&&${sess}.gitBranch.value)||"",` +
  `WT=(${sess}.worktree&&${sess}.worktree.value)||null;` +
  `if(WT&&WT.branch)BR=WT.branch;` +
  // configured-value fallback ONLY for brand-new sessions (no messages yet): there the settings
  // value IS what the session will launch with. Resumed/reloaded sessions may carry in-session
  // /model overrides, so they stay hidden until the live session reports the real model.
  `if(!Mv&&!(((${sess}.messages&&${sess}.messages.value)||[]).length)){` +
  `var Ms=(${sess}.modelSelection&&${sess}.modelSelection.value)||"";` +
  `if(Ms&&Ms!=="default")Mv=Ms.replace(/\\[1m\\]$/,"")}` +
  `var ` +
  `EF=(${sess}.effortLevel&&${sess}.effortLevel.value)||"",` +
  // computed signal: thinkingLevelOverride ?? connection config thinkingLevel ?? "off"
  `TH=(${sess}.thinkingLevel&&${sess}.thinkingLevel.value)||"",` +
  `W=U.contextWindow||0,T=U.totalTokens||0,CO=U.totalCost||0,` +
  `P=W>0?Math.round(Math.min(T/W*100,100)):0,` +
  `F=function(n){return n>=1e6?(n/1e6).toFixed(1).replace(/\\.0$/,"")+"M":n>=1e3?Math.round(n/1e3)+"k":""+n};` +
  // "claude-opus-4-8" -> "Opus 4.8", "claude-fable-5" -> "Fable 5" (date-stamp segments dropped)
  `var ps=Mv.replace(/^claude-/,"").split("-").filter(function(p){return !/^\\d{8}$/.test(p)}),MN=[],i;` +
  `for(i=0;i<ps.length;i++){var p=ps[i];` +
  `if(/^\\d+$/.test(p)&&MN.length&&/\\d$/.test(MN[MN.length-1]))MN[MN.length-1]+="."+p;` +
  `else MN.push(p.charAt(0).toUpperCase()+p.slice(1));}` +
  `MN=MN.join(" ");` +
  `var L=[];` +
  `if(MN)L.push(["model",MN]);` +
  `if(BR)L.push(["branch","("+BR+")"]);` +
  // window size only arrives with the first end-of-turn result event — show bare tokens until then
  `if(W>0)L.push(["ctx",F(T)+"/"+F(W)+" ("+P+"%)"]);` +
  `else if(T>0)L.push(["ctx",F(T)+" tok"]);` +
  `if(Mv&&EF)L.push(["effort","e:"+EF]);` +
  `if(Mv&&TH&&TH!=="off")L.push(["think",/^(on|default_on)$/.test(TH)?"think":"think:"+TH]);` +
  `if(CO>=0.005)L.push(["cost","$"+CO.toFixed(2)]);` +
  // theme-aware colors from the charts palette (adapt to light/dark themes)
  `var GRN="var(--vscode-charts-green,#89d185)",YEL="var(--vscode-charts-yellow,#cca700)",` +
  `RED="var(--vscode-charts-red,#f14c4c)",BLU="var(--vscode-charts-blue,#4fc1ff)";` +
  `var CH={model:BLU,branch:"var(--vscode-charts-purple,#b180d7)",think:"var(--vscode-charts-orange,#d18616)",cost:YEL};` +
  `var col=P>=80?RED:P>=50?YEL:GRN;` +
  `var ecol=EF==="max"||EF==="xhigh"?RED:EF==="high"?YEL:EF==="medium"?BLU:GRN;` +
  `var kids=L.map(function(s){` +
  `var c=s[0]==="ctx"?col:s[0]==="effort"?ecol:CH[s[0]]||"var(--vscode-descriptionForeground)";` +
  `var st={color:c,background:"color-mix(in srgb, "+c+" 12%, transparent)",borderRadius:"999px",padding:"1px 7px",lineHeight:"16px"};` +
  // the context pill doubles as a progress bar: its background fills to the usage percentage
  `if(s[0]==="ctx"&&W>0)st.background="linear-gradient(90deg, color-mix(in srgb, "+c+" 30%, transparent) "+P+"%, color-mix(in srgb, "+c+" 10%, transparent) "+P+"%)";` +
  `return ${jsx}("span",{"data-seg":s[0],style:st,children:s[1]})});` +
  // gear leads the group, next to Claude's own footer buttons: always rendered, so
  // settings stay reachable even when every segment is hidden or empty
  `kids.unshift(${jsx}("button",{type:"button",className:"cc-gear",title:"Status bar settings","aria-label":"Status bar settings",` +
  `onClick:function(ev){if(window.__ccStatus)window.__ccStatus.openMenu(ev)},` +
  `style:{cursor:"pointer",border:"none",background:"transparent",color:"inherit",fontSize:"13px",padding:"0 2px",opacity:"0.6",lineHeight:"1"},` +
  `children:"\\u2699"}));` +
  // inline sits centred in Claude's toolbar row; the own-row copy spans the panel and
  // wraps instead of overflowing, since nothing else shares its line
  `var IS={fontSize:"11px",whiteSpace:"nowrap",direction:"ltr",alignSelf:"center",padding:"0 6px",` +
  `display:"inline-flex",alignItems:"center",gap:"6px",color:"var(--vscode-descriptionForeground)"};` +
  `var RS={fontSize:"11px",direction:"ltr",padding:"0 8px 6px",` +
  `display:"flex",flexWrap:"wrap",alignItems:"center",gap:"6px",color:"var(--vscode-descriptionForeground)"};` +
  `var A=(window.__ccStatus=window.__ccStatus||{});` +
  `A.__mk=function(v){return ${jsx}("span",{className:"${MARKER} cc-"+v,style:v==="row"?RS:IS,children:kids})};` +
  `return A.__mk("inline")})()`;

// The own-row copy, added to the fragment that wraps the footer, just ahead of the row
// Claude drops its model pill into at fit stage 2. Reuses the builder the inline copy
// left on window, which is safe because array children evaluate in order.
const chipRow = () => `(window.__ccStatus&&window.__ccStatus.__mk?window.__ccStatus.__mk("row"):null)`;

// Anchor for that fragment slot: the head of Claude's conditional second row,
// `M===2&&D("div",{className:F9.modelPillRow,`. Only the head is matched and we insert
// ahead of it, so we never have to find where its expression ends -- what Claude puts
// inside that row keeps changing (a bare identifier in 2.1.258, a component call in
// 2.1.261, which is what silently cost us the own row on that version). Searched only
// just after the usage button anchor, so we can not land in a similar-looking component.
const reRow = /[\w$]+===2&&[\w$]+\("div",\{className:[\w$]+\.modelPillRow,/;

function run() {
  const ext = findExtension();
  if (!ext) return { status: "none", message: "cc-status: Claude Code VSCode extension not found — nothing to patch" };
  let src = fs.readFileSync(ext.file, "utf8");
  if (src.includes(MARKER)) return { status: "already", file: ext.file, message: "cc-status: already patched — " + ext.file };
  const m = src.match(re);
  if (!m) return {
    status: "anchor-missing", file: ext.file,
    message: "cc-status: anchor not found in " + ext.file + " — the extension bundle changed; the patch needs updating for this version.",
  };
  const bak = ext.file + ".cc-status.bak";
  if (!fs.existsSync(bak)) fs.copyFileSync(ext.file, bak);
  src = src.replace(re, (whole, jsx, _comp, sess) => whole + chip(jsx, sess));
  // second injection: the own-row copy. Optional -- without it the chip simply stays
  // inline (pre-2.1.25x behaviour) instead of failing the whole patch.
  const from = src.indexOf(MARKER);
  const win = src.slice(from, from + 12000);
  const mRow = win.match(reRow);
  if (mRow) {
    const at = from + mRow.index;
    src = src.slice(0, at) + chipRow() + "," + src.slice(at);
  }
  // leading \n in case the bundle ends with a // comment (e.g. sourceMappingURL)
  src += "\n" + runtime + "\n";
  fs.writeFileSync(ext.file, src);
  return {
    status: "patched", file: ext.file, rowMode: !!mRow,
    message: "cc-status: patched " + ext.file + " (backup: " + path.basename(bak) + ")" +
      (mRow ? "" : " [own-row anchor not found -- chip stays inline]") + ". Reload the VSCode window to see it.",
  };
}

module.exports = { run };
if (require.main === module) console.log(run().message);
