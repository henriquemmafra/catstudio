/** Estrutura da área de trabalho do Ostium (montada por app.ts). */
export const TEMPLATE = `
<header>
  <div class="brand">
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="#f2ead3" stroke-width="2"/><circle cx="5.2" cy="14.5" r="2.6" fill="#0a1a38" stroke="#f2ead3" stroke-width="1.6"/><circle cx="18.6" cy="13" r="2.6" fill="#0a1a38" stroke="#f2ead3" stroke-width="1.6"/></svg>
    Ostium <small>laudo coronário · v0.5.1</small>
  </div>
  <div class="pipeline" id="pipeline"></div>
  <div class="hspace"></div>
  <div class="modebox">
    <div class="hw" id="hw"></div>
    <div class="seg" id="modes" role="group" aria-label="Modo de desempenho"></div>
    <button class="btn" id="closeostium" type="button">Voltar às imagens</button>
  </div>
</header>
<main>
  <section class="col">
    <div class="colhead">
      <h2>Mapa coronário</h2>
      <div class="seg" id="viewsw" role="group" aria-label="Vista do mapa"></div>
      <span class="sp"></span>
      <div class="seg" id="dominance" role="group" aria-label="Dominância"></div>
      <button class="btn primary useseries" type="button" title="Mede o escore de cálcio na série que está aberta no CatStudio">Ler série aberta</button>
    </div>
    <div id="mapwrap">
      <div id="stage3">
        <canvas id="gl" aria-label="Mapa coronário 3D: arraste para girar, clique no vaso para marcar"></canvas>
        <div id="labels3"></div>
        <div class="seg" id="camera" role="group" aria-label="Vista da câmera"></div>
        <div class="maphint">Arraste para girar · role para aproximar<br>Clique no vaso para marcar o ponto da placa</div>
      </div>
      <svg id="flat" viewBox="56 40 550 540" role="group" aria-label="Mapa coronário planificado"></svg>
      <div id="cacstage" style="display:none">
        <div id="cactools">
          <div class="chips" id="tools" role="group" aria-label="Vaso a atribuir"></div>
          <span class="tl">Laço</span><div class="seg" id="spread" role="group" aria-label="Alcance do laço"></div>
          <span class="sp"></span>
          <button class="btn" id="prevf" type="button" title="Foco anterior">‹ foco</button>
          <button class="btn" id="nextf" type="button" title="Próximo foco">foco ›</button>
          <button class="btn" id="undo" type="button" title="Ctrl+Z">Desfazer</button>
          <button class="btn" id="zoom1" type="button">Ajustar</button>
        </div>
        <div id="cacbox"></div>
        <div id="cacempty">
          <div class="big">Escore de cálcio na imagem</div>
          <p>Abra o exame no CatStudio, selecione a série do escore (sem contraste, 3 mm) e clique abaixo. As imagens ficam neste computador.</p>
          <button class="btn primary useseries" type="button">Ler série aberta</button>
          <p id="cacstatus" role="status"></p>
        </div>
        <div id="cacfoot">
          <span id="seriesname"></span>
          <input type="range" id="slider" min="0" max="0" value="0" aria-label="Corte">
          <span id="slicelab"></span>
          <div id="cacmsg" role="status"></div>
        </div>
      </div>
      <div id="no3d" style="display:none">Este computador não abriu o 3D. Usando o mapa planificado.</div>
    </div>
    <div class="legend" id="legend"></div>
  </section>
  <section class="col">
    <div class="colhead">
      <h2>Achados</h2><span class="sp"></span>
      <select class="sel" id="examples" aria-label="Carregar exemplo" style="max-width:130px">
        <option value="">Exemplos…</option><option value="normal">Normal</option><option value="doente">Placas + limitação</option><option value="grave">Oclusão, dominância esquerda</option>
      </select>
      <button class="btn danger" id="reset">Novo exame</button>
    </div>
    <div id="side">
      <div class="panel" id="inspector"></div>
      <div class="panel" id="exam"></div>
      <div class="panel" id="calcium"></div>
      <div class="panel" id="additional"></div>
    </div>
  </section>
  <section class="col" id="reportcol">
    <div class="colhead"><h2>Laudo</h2><span class="tag">texto puro · AGFA</span><span class="sp"></span><button class="btn primary" id="copy">Copiar laudo</button></div>
    <div id="statebar" style="display:none"></div>
    <div id="warnbox"><strong>Avisos, não entram no laudo</strong><ul id="warnings"></ul></div>
    <div id="report"></div>
    <div class="status" id="status"></div>
  </section>
</main>
`;
