/**
 * Estilos do Ostium, aninhados sob .ostium para não vazarem para o CatStudio (nem o contrário).
 * Sem fontes externas: o CatStudio não faz nenhuma requisição fora da própria página.
 */
export const STYLES = `
@keyframes ostium-flash { from { background: rgba(242,234,211,.3); } to { background: transparent; } }
.ostium {
  position: fixed; inset: 0; z-index: 1500; display: flex; flex-direction: column; height: auto; margin: 0;

/* Layout: estação de laudo em tela única — mapa coronário (3D ou planificado) | achados | laudo ao vivo.
   Identidade do metapaths: prancha de atlas sobre azul-noite, marfim como acento. Visual único, escuro. */
& {
  color-scheme: dark;
  --bg: #06122a; --bg-hi: #0d2348; --panel: #0a1a38; --raised: #0f2347; --line: #26446f; --line-soft: rgba(96,136,196,.26);
  --ink: #eaf0f9; --ink-2: #aebfda; --ink-3: #7891b5; --ivory: #f2ead3; --ivory-ink: #0b1a36; --ivory-soft: rgba(242,234,211,.12);
  --warn: #f3c84f; --danger: #ff4a4a;
  --f-display: Georgia, "Times New Roman", serif;
  --f-ui: Roboto, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --f-label: Roboto, "Arial Narrow", system-ui, sans-serif;
  --f-mono: ui-monospace, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
& { background: var(--bg); color: var(--ink); font: 13px/1.45 var(--f-ui); display: flex; flex-direction: column; -webkit-font-smoothing: antialiased; }
button, select, input { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--ivory); outline-offset: 2px; }

header { display: flex; align-items: center; gap: 16px; padding: 0 16px; height: 56px; flex: none; border-bottom: 1px solid var(--line); background: var(--panel); }
.brand { display: flex; align-items: baseline; gap: 9px; font: 600 21px/1 var(--f-display); color: var(--ivory); white-space: nowrap; }
.brand svg { align-self: center; }
.brand small { font: 500 11px var(--f-label); color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
.pipeline { display: flex; gap: 6px; margin-left: 6px; min-width: 0; }
.stage { display: flex; align-items: center; gap: 7px; padding: 5px 11px; border: 1px solid var(--line-soft); border-radius: 999px; white-space: nowrap; }
.stage b { font: 500 12.5px var(--f-label); letter-spacing: .01em; }
.stage span { font-size: 11px; color: var(--ink-3); }
.stage i { width: 7px; height: 7px; border-radius: 50%; background: #36d3a8; flex: none; }
.stage.soon i { background: none; border: 1.5px solid var(--ink-3); }
.stage.soon b { color: var(--ink-3); }
@media (max-width: 1620px) { .stage span { display: none; } }
.hspace { flex: 1; }
.modebox { display: flex; align-items: center; gap: 10px; }
.modebox .hw { font-size: 11px; color: var(--ink-3); white-space: nowrap; cursor: help; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px; background: rgba(8,20,44,.84); }
.seg button { border: 0; background: transparent; border-radius: 999px; padding: 5px 11px; cursor: pointer; color: var(--ink-2); font: 500 12px/1 var(--f-ui); white-space: nowrap; }
.seg button:hover { color: var(--ink); }
.seg button[aria-pressed="true"] { background: var(--ivory); color: var(--ivory-ink); font-weight: 600; }
.seg button:disabled { opacity: .4; cursor: not-allowed; }

main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(420px, 1.25fr) minmax(320px, .8fr) minmax(360px, 1.05fr); }
.col { min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); }
.col:last-child { border-right: 0; }
.colhead { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--line-soft); flex: none; min-height: 48px; flex-wrap: wrap; background: var(--panel); }
.colhead h2 { font: 600 16px var(--f-display); margin: 0; color: var(--ivory); }
.colhead .sp { flex: 1; }
.btn { background: var(--raised); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.btn:hover { border-color: var(--ivory); color: var(--ivory); }
.btn.primary { background: var(--ivory); border-color: var(--ivory); color: var(--ivory-ink); font-weight: 600; }
.btn.primary:hover { filter: brightness(1.06); color: var(--ivory-ink); }
.btn.danger:hover { border-color: var(--danger); color: var(--danger); }
select.sel, input.num { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 7px; }
input.num { width: 70px; font-variant-numeric: tabular-nums; }
input[type=range] { width: 100%; accent-color: var(--ivory); }

#mapwrap { flex: 1; min-height: 0; position: relative; background: radial-gradient(ellipse at 50% 40%, #15386e 0%, #0a2048 42%, #030a1a 100%); overflow: hidden; }
#stage3 { position: absolute; inset: 0; }
#gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; outline: none; }
#labels3 { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.lab3 { position: absolute; left: 0; top: 0; white-space: nowrap; font: 500 12px/1.2 var(--f-label); color: var(--ink); background: rgba(6,16,36,.88); border: 1px solid #2b4a7c; border-radius: 5px; padding: 3px 7px; will-change: transform; }
.lab3.name { font-weight: 600; font-size: 13px; color: var(--ivory); }
.lab3.dim { color: var(--ink-3); }
.lab3.small { font-size: 11px; color: var(--ink-2); padding: 2px 6px; }
.lab3.ghost { font-size: 11px; color: var(--ink-3); border-style: dashed; background: rgba(6,16,36,.6); }
.lab3.badge { font: 600 10.5px/1 var(--f-mono); padding: 3px 5px; border-width: 1.5px; }
#camera { position: absolute; left: 12px; bottom: 12px; }
.maphint { position: absolute; right: 12px; bottom: 14px; font-size: 11px; color: var(--ink-3); pointer-events: none; text-align: right; }
#no3d { position: absolute; left: 12px; top: 10px; font-size: 11px; color: var(--warn); }
#flat { position: absolute; inset: 0; width: 100%; height: 100%; padding: 6px 10px; }
#flat text { font-family: var(--f-label); fill: var(--ink-2); font-size: 12px; font-weight: 500; pointer-events: none; user-select: none; }
#flat text.big { font-size: 14px; font-weight: 600; fill: var(--ivory); }
#flat .hit { stroke: transparent; stroke-width: 24; fill: none; cursor: crosshair; }
#flat .ves { fill: none; stroke-linecap: round; stroke-width: 8; stroke: var(--ivory); pointer-events: none; }
#flat .ves.br { stroke-width: 5.5; }
#flat .ves.limited { stroke: #8fa0b8; stroke-dasharray: 3 9; }
#flat .halo { fill: none; stroke: var(--ivory); stroke-linecap: round; stroke-width: 20; opacity: 0; pointer-events: none; }
#flat .halo.br { stroke-width: 15; }
#flat g.el:hover .halo { opacity: .08; }
#flat g.el.hl .halo { opacity: .22; }
#flat .pl { fill: none; stroke-linecap: butt; pointer-events: none; }
#flat .pl.hl { filter: brightness(1.35) drop-shadow(0 0 5px currentColor); }
#flat .ghost { fill: none; stroke: var(--ink-3); stroke-width: 2; stroke-dasharray: 4 6; stroke-linecap: round; pointer-events: none; }
#flat g.gh { cursor: pointer; }
#flat g.gh:hover .ghost { stroke: var(--ivory); }
#flat g.gh text { fill: var(--ink-3); font-size: 11px; }
#flat g.gh:hover text { fill: var(--ivory); }
#flat .joint { fill: var(--bg); stroke: var(--ink-3); stroke-width: 1.5; pointer-events: none; }
#flat .badge { pointer-events: none; }
#flat .badge rect { fill: rgba(6,16,36,.92); stroke-width: 1.4; }
#flat .badge text { font: 600 10px var(--f-mono); text-anchor: middle; }
#flat .aorta { fill: rgba(207,198,173,.12); stroke: #cfc6ad; stroke-width: 3; }
#flat .cursor { fill: none; stroke: var(--ivory); stroke-width: 2.5; pointer-events: none; }
#mapwrap.drop::after { content: "Solte a pasta do exame"; position: absolute; inset: 10px; border: 2px dashed var(--ivory); border-radius: 12px; display: grid; place-items: center; font: 600 20px var(--f-display); color: var(--ivory); background: rgba(6,18,42,.8); pointer-events: none; z-index: 5; }
#cacstage { position: absolute; inset: 0; display: flex; flex-direction: column; background: #000; }
#cacstage[style*="none"] { display: none; }
#cactools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--line-soft); flex: none; }
#cactools .tl { font-size: 11px; color: var(--ink-3); margin-left: 6px; }
#cactools .sp { flex: 1; }
#cacbox { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #000; }
.cacimg { position: absolute; cursor: crosshair; touch-action: none; image-rendering: auto; }
#cacempty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 24px; background: radial-gradient(ellipse at 50% 40%, #15386e 0%, #0a2048 42%, #030a1a 100%); }
#cacempty .big { font: 600 24px var(--f-display); color: var(--ivory); }
#cacempty p { margin: 0; max-width: 46ch; color: var(--ink-2); }
#cacstatus { color: var(--warn) !important; min-height: 1.4em; }
#cacfoot { display: grid; grid-template-columns: minmax(120px, 1.2fr) 2fr auto; gap: 6px 10px; align-items: center; padding: 8px 12px; background: var(--panel); border-top: 1px solid var(--line-soft); flex: none; }
#cacfoot #slicelab { font: 500 12px var(--f-mono); color: var(--ink-2); white-space: nowrap; }
#cacfoot #cacmsg { grid-column: 1 / -1; font-size: 12px; color: var(--ink-2); min-height: 1.4em; }
#cacfoot #seriesname { font-size: 12px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 8px 14px 10px; border-top: 1px solid var(--line-soft); flex: none; font-size: 11px; color: var(--ink-2); background: var(--panel); }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend i { width: 16px; height: 5px; border-radius: 3px; display: inline-block; }
.legend i.dash { background: repeating-linear-gradient(90deg, #8fa0b8 0 3px, transparent 3px 6px); }

#side { flex: 1; min-height: 0; overflow: auto; background: var(--bg); }
.panel { padding: 12px 14px 14px; border-bottom: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 10px; }
.panel h3 { margin: 0; font: 600 11px var(--f-label); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
#inspector { background: var(--panel); }
#inspector .title { font: 600 18px/1.2 var(--f-display); color: var(--ivory); }
#inspector .sub { color: var(--ink-2); font-size: 12.5px; margin-top: -6px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field > .lab { font-size: 11px; color: var(--ink-3); }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip { background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
.chip:hover { border-color: var(--ink-2); }
.chip[aria-pressed="true"] { background: var(--ivory); border-color: var(--ivory); color: var(--ivory-ink); font-weight: 600; }
.chip i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.chip small { color: var(--ink-3); font-size: 10px; }
.chip[aria-pressed="true"] small { color: inherit; opacity: .7; }
.row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.row .f { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.hint { color: var(--ink-2); font-size: 12.5px; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.kpi { background: var(--panel); border: 1px solid var(--line-soft); border-radius: 8px; padding: 7px 9px; }
.kpi span { display: block; font: 500 10px var(--f-label); color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
.kpi b { font: 600 19px var(--f-display); color: var(--ivory); font-variant-numeric: tabular-nums; }
.kpi em { font-style: normal; font-size: 10px; color: var(--warn); margin-left: 4px; }
.cac { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.cac label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--ink-3); }
.cac input { width: 100%; }
.tag { font: 500 10px var(--f-label); border: 1px solid var(--line); color: var(--ink-3); border-radius: 999px; padding: 2px 8px; letter-spacing: .06em; text-transform: uppercase; }

#reportcol { background: var(--panel); }
#warnbox { margin: 10px 14px 0; background: rgba(243,200,79,.09); border: 1px solid rgba(243,200,79,.32); border-radius: 8px; padding: 7px 10px; color: var(--warn); font-size: 11.5px; flex: none; }
#warnbox ul { margin: 3px 0 0; padding-left: 16px; }
#report { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 20px; font: 12.5px/1.62 var(--f-mono); }
.line { padding: 1px 6px; border-radius: 4px; border-left: 2px solid transparent; white-space: pre-wrap; }
.line.src { cursor: pointer; }
.line.src:hover { background: var(--ivory-soft); border-left-color: var(--ivory); }
.line.blank { height: .9em; }
.line.flash { animation: ostium-flash 1.5s ease-out; }
.status { flex: none; border-top: 1px solid var(--line-soft); padding: 7px 14px; font-size: 11px; color: var(--ink-3); display: flex; gap: 14px; flex-wrap: wrap; }
@media (prefers-reduced-motion: reduce) { .line.flash { animation: none; } }
@media (max-width: 1180px) {
  & { overflow: auto; }
  main { flex: none; }
  main { grid-template-columns: 1fr; }
  .col { border-right: 0; border-bottom: 1px solid var(--line); }
  #mapwrap { height: 540px; flex: none; }
  #side, #report { overflow: visible; }
  header { height: auto; flex-wrap: wrap; padding: 8px 16px; gap: 10px; }
  .modebox .hw { display: none; }
}

}
`;
