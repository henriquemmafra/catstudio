"""CatStudio — testes ponta a ponta no navegador (Chrome/Chromium + Playwright).

O build estático (pasta dist) é servido localmente; cada teste abre o
CatStudio, carrega séries sintéticas pelo seletor de arquivos/pasta, e confere
pela store Pinia a geometria do volume reconstruído contra o fantoma analítico.

    npm run build                       # gera dist/
    python3 catstudio-testes/make_fixtures.py
    python3 -m pytest catstudio-testes -v

Variáveis: CATSTUDIO_URL (testar um site já publicado), CHROME (executável).
"""
import functools
import http.server
import io
import json
import os
import shutil
import socket
import sys
import threading
import time

import numpy as np
import pytest
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, ".data")
DIST = os.path.join(HERE, "..", "dist")
sys.path.insert(0, HERE)
from make_fixtures import FAKE_ID, FAKE_NAME, phantom  # noqa: E402

MARKER = np.array([90.0, -20.0, 40.0])  # esfera de 1000 HU do fantoma (LPS)

PINIA = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia"

EXTRACT = r"""
(n) => {
  const pinia = %s;
  const cache = pinia._s.get('image-cache');
  const out = [];
  for (const id of [...cache.imageIds]) {
    const img = cache.getVtkImageData(id);
    if (!img) { out.push({id, empty: true}); continue; }
    const dims = img.getDimensions();
    const scal = img.getPointData().getScalars().getData();
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) %% 2147483648; return seed / 2147483648; };
    const samples = [];
    for (let s = 0; s < n; s++) {
      const i = Math.floor(rnd() * dims[0]), j = Math.floor(rnd() * dims[1]), k = Math.floor(rnd() * dims[2]);
      const w = img.indexToWorld([i, j, k], [0, 0, 0]);
      samples.push([w[0], w[1], w[2], scal[i + dims[0] * (j + dims[1] * k)]]);
    }
    let ci = 0, cj = 0, ck = 0, cn = 0;
    for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) {
      const off = dims[0] * (j + dims[1] * k);
      for (let i = 0; i < dims[0]; i++) if (scal[off + i] > 850) { ci += i; cj += j; ck += k; cn++; }
    }
    const marker = cn ? img.indexToWorld([ci / cn, cj / cn, ck / cn], [0, 0, 0]) : null;
    out.push({id, dims, spacing: img.getSpacing(), samples, marker, markerVoxels: cn});
  }
  return out;
}
""" % PINIA


# ------------------------------------------------------------------ infraestrutura

class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def url():
    if os.environ.get("CATSTUDIO_URL"):
        yield os.environ["CATSTUDIO_URL"].rstrip("/") + "/"
        return
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        pytest.skip("dist/ não encontrado: rode `npm run build` antes")
    if not os.path.isdir(DATA):
        pytest.skip("fantomas não gerados: rode make_fixtures.py antes")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    handler = functools.partial(_Quiet, directory=os.path.abspath(DIST))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{port}/"
    httpd.shutdown()


def _chrome():
    for c in [os.environ.get("CHROME"), "/usr/bin/google-chrome", "/usr/bin/chromium",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe"]:
        if c and os.path.exists(c):
            return c
    return None  # Chromium do Playwright


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            executable_path=_chrome(),
            args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                  "--ignore-gpu-blocklist"],
        )
        yield b
        b.close()


class Session:
    def __init__(self, browser, url, init_script=None):
        self.url = url
        self.page = browser.new_page(viewport={"width": 1600, "height": 950}, accept_downloads=True)
        if init_script:
            self.page.add_init_script(init_script)
        self.external = []
        self.errors = []
        local = (url, "blob:", "data:")
        self.page.on("request", lambda r: None if r.url.startswith(local) else self.external.append(r.url))
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(url, wait_until="networkidle")
        self.page.get_by_text("Abrir pasta do exame").first.wait_for(timeout=60000)

    def close(self):
        self.page.close()

    def open_files(self, paths):
        with self.page.expect_file_chooser() as fc:
            self.page.get_by_test_id("welcome-open-files").click()
        fc.value.set_files(paths)
        self.wait_loaded()

    def open_folder(self, folder):
        with self.page.expect_file_chooser() as fc:
            self.page.get_by_test_id("welcome-open-folder").click()
        assert fc.value.element.get_attribute("webkitdirectory") is not None
        fc.value.set_files(folder)
        self.wait_loaded()

    def state(self):
        return self.page.evaluate(f"""() => {{ const p = {PINIA}; const c = p._s.get('image-cache');
            const shown = new Set(Object.values(p._s.get('view').viewByID).map(v => v.dataID).filter(Boolean));
            return [...c.imageIds].map(i => ({{id: i, shown: shown.has(i), st: c.imageStatus[i], ld: !!c.imageLoading[i]}})); }}""")

    def wait_loaded(self, timeout=180, everything=False):
        """Espera os volumes exibidos (ou todos) terminarem de carregar."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            st = [x for x in self.state() if everything or x["shown"]]
            if st and all(x["st"] == "complete" and not x["ld"] for x in st):
                self.wait_idle()
                return
            self.page.wait_for_timeout(400)
        raise AssertionError("o volume não terminou de carregar")

    def wait_idle(self, timeout=180):
        """Espera a página ficar responsiva (WebGL por software é lento: logo
        depois de carregar, a renderização 3D e as miniaturas dos presets
        ocupam a thread principal por dezenas de segundos)."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            frames = self.page.evaluate("""() => new Promise(res => { let n = 0; const t0 = performance.now();
                const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); };
                requestAnimationFrame(f); })""")
            if frames >= 20:
                return
        raise AssertionError("a página não ficou responsiva")

    def load_all(self):
        """Carrega também as séries não exibidas (o CatStudio carrega sob demanda)."""
        self.page.evaluate(f"""() => {{ const c = {PINIA}._s.get('image-cache');
            Object.values(c.imageById).forEach(im => im.startLoad && im.startLoad()); }}""")
        self.wait_loaded(everything=True)

    def volumes(self, samples=8000):
        self.load_all()
        return self.page.evaluate(EXTRACT, samples)

    def messages(self):
        return self.page.evaluate(f"""() => Object.values({PINIA}._s.get('message').byID || {{}})
            .map(m => (m.title || '') + ' — ' + ((m.options && m.options.details) || ''))""")


@pytest.fixture
def session(browser, url):
    s = Session(browser, url)
    yield s
    s.close()
    assert not s.external, f"requisições externas: {s.external[:5]}"


def files_of(case):
    root = os.path.join(DATA, case)
    return [os.path.join(dp, f) for dp, _, fs in os.walk(root) for f in sorted(fs)]


def judge(vol):
    s = np.array(vol["samples"], float)
    ref = phantom(s[:, 0], s[:, 1], s[:, 2])
    keep = s[:, 3] > -2000
    err = np.abs(s[:, 3] - ref)[keep]
    marker = None if vol["marker"] is None else float(np.linalg.norm(np.array(vol["marker"]) - MARKER))
    return float(err.mean()), float((err > 100).mean()), marker


# ------------------------------------------------------------------ geometria

GEOMETRY = {
    # caso: (volumes, erro médio máx HU, fração >100 HU máx, desvio do marcador máx mm, aviso esperado)
    "ax_main": (1, 1.0, 0.001, 0.3, None),
    "ax_implicit": (1, 1.0, 0.001, 0.3, None),
    "cor_acq": (1, 1.0, 0.001, 0.3, None),
    "oblique": (1, 1.0, 0.001, 0.3, None),
    "tilt": (1, 6.0, 0.002, 0.5, "Gantry inclinado"),
    "irregular": (1, 2.0, 0.002, 0.5, "irregular"),
    "gap": (1, 6.0, 0.015, 0.5, "Lacuna"),
    "enhanced": (1, 1.0, 0.001, 0.3, None),
    "codecs/j2k": (1, 1.0, 0.001, 0.3, None),
    "codecs/j2k_unsigned": (1, 1.0, 0.001, 0.3, None),
    "codecs/jls": (1, 1.0, 0.001, 0.3, None),
    "codecs/rle": (1, 1.0, 0.001, 0.3, None),
    "codecs/jpegll": (1, 1.0, 0.001, 0.3, None),
    "codecs/deflate": (1, 1.0, 0.001, 0.3, None),
    "codecs/bigendian": (1, 1.0, 0.001, 0.3, None),
}


@pytest.mark.parametrize("case", list(GEOMETRY))
def test_geometria_contra_fantoma(session, case):
    n_vol, max_mean, max_frac, max_marker, warning = GEOMETRY[case]
    session.open_files(files_of(case))
    vols = session.volumes()
    assert len(vols) == n_vol, [v.get("dims") for v in vols]
    mean, frac, marker = judge(vols[0])
    assert mean <= max_mean, f"erro médio {mean:.2f} HU"
    assert frac <= max_frac, f"{100 * frac:.2f}% dos voxels com erro >100 HU"
    assert marker is not None and marker <= max_marker, f"marcador a {marker} mm"
    msgs = " | ".join(session.messages())
    if warning:
        assert warning in msgs, msgs
    else:
        assert "Lacuna" not in msgs and "Gantry" not in msgs, msgs
    assert not session.errors, session.errors


def test_aquisicoes_repetidas_viram_volumes_separados(session):
    session.open_files(files_of("dup"))
    vols = sorted(session.volumes(), key=lambda v: -v["dims"][2])
    assert [v["dims"][2] for v in vols] == [81, 5]
    mean, frac, marker = judge(vols[0])
    assert mean < 1 and frac < 0.001 and marker < 0.3
    msgs = " | ".join(session.messages())
    assert "Aquisições separadas" in msgs and "Arquivos repetidos" in msgs, msgs


def test_matrizes_diferentes_viram_volumes_separados(session):
    session.open_files(files_of("mixed_dims"))
    vols = session.volumes()
    assert len(vols) == 2
    for v in vols:
        mean, frac, _ = judge(v)
        assert mean < 1 and frac < 0.001
    assert "Série dividida" in " | ".join(session.messages())


# ------------------------------------------------------------------ entrada

def test_abrir_pasta_do_exame(session):
    session.open_folder(os.path.join(DATA, "ax_main"))
    vols = session.volumes(2000)
    assert len(vols) == 1 and vols[0]["dims"] == [320, 300, 81]


def test_zip_com_varios_estudos(session):
    session.open_files([os.path.join(DATA, "multi.zip")])
    vols = session.volumes(2000)
    sizes = sorted(v["dims"][2] for v in vols)
    assert len(vols) >= 3, sizes
    assert 81 in sizes, sizes


# ------------------------------------------------------------------ privacidade

def _phi_free(text):
    t = text.upper()
    return not any(x in t for x in ("NAO^EXIBIR", "NAO EXIBIR", "EXIBIR", FAKE_ID, FAKE_NAME))


def test_identificacao_do_paciente_nunca_aparece(session):
    page = session.page
    assert "CatStudio" in page.title()
    session.open_files(files_of("ax_main"))
    page.get_by_text("Paciente 1").first.wait_for(timeout=20000)
    assert _phi_free(page.inner_text("body"))
    # janela de informações DICOM de uma vista 2D
    info = page.locator(".mdi-information").first
    info.hover()
    page.wait_for_timeout(800)
    info.click(force=True)
    page.wait_for_timeout(800)
    assert _phi_free(page.inner_text("body"))
    assert _phi_free(page.content())


# ------------------------------------------------------------------ 3D e exportação

def _image_std(png_bytes):
    from PIL import Image
    im = np.asarray(Image.open(io.BytesIO(png_bytes)).convert("L"), float)
    return im.std(), im.shape


def test_renderizacao_3d_e_exportacao_png(session, tmp_path):
    page = session.page
    session.open_files(files_of("ax_main"))
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    page.wait_for_timeout(3000)
    std, _ = _image_std(view.screenshot())
    assert std > 5, "vista 3D vazia"
    with page.expect_download() as dl:
        page.get_by_test_id("export-3d-menu").first.click()
        page.get_by_test_id("export-3d-1x").click()
    d = dl.value
    assert d.suggested_filename.startswith("catstudio-3d-") and d.suggested_filename.endswith(".png")
    path = tmp_path / d.suggested_filename
    d.save_as(path)
    std, shape = _image_std(path.read_bytes())
    assert std > 5 and shape[0] > 100 and shape[1] > 100
    assert not session.errors, session.errors


# ------------------------------------------------------------------ memória

BIG = os.path.join(DATA, "exame_grande")


needs_big = pytest.mark.skipif(not os.path.isdir(BIG), reason="rode make_exame_grande.py para gerar o exame completo")


def _open_big(session, sample=None):
    """Abre a pasta do exame completo e espera a lista de séries (triagem)."""
    page = session.page
    with page.expect_file_chooser() as fc:
        page.get_by_test_id("welcome-open-folder").click()
    fc.value.set_files(BIG)
    dialog = page.get_by_test_id("series-triage")
    t0 = time.time()
    while not dialog.is_visible():
        assert time.time() - t0 < 120, "a lista de séries não apareceu"
        if sample:
            sample()
        page.wait_for_timeout(500)
    return dialog


def _descriptions(session):
    return session.page.evaluate(f"""() => {{ const p = {PINIA}; const d = p._s.get('dicom');
        const shown = new Set(Object.values(p._s.get('view').viewByID).map(v => v.dataID).filter(Boolean));
        return Object.entries(d.volumeInfo).map(([id, v]) => ({{desc: (v.SeriesDescription || '').trim(), shown: shown.has(id)}})); }}""")


@needs_big
def test_triagem_sugere_a_serie_e_carrega_so_a_escolhida(session):
    """Exame grande: antes de carregar, aparece a lista de séries com a
    sugerida marcada. Confirmar carrega só ela, e o 3D usa a cópia reduzida."""
    page = session.page
    dialog = _open_big(session)
    items = dialog.get_by_test_id("series-triage-item")
    assert items.count() == 7
    assert not session.state(), "nada deve carregar antes da escolha"
    suggested = [items.nth(i).inner_text() for i in range(7) if "Sugerida" in items.nth(i).inner_text()]
    assert len(suggested) == 1 and "Fase arterial" in suggested[0], suggested
    assert "1 série" in page.get_by_test_id("series-triage-confirm").inner_text().lower()
    page.get_by_test_id("series-triage-confirm").click()
    session.wait_loaded(timeout=400)
    st = session.state()
    assert len(st) == 1 and st[0]["shown"] and st[0]["st"] == "complete", st
    assert [d["desc"] for d in _descriptions(session)] == ["Fase arterial 1 mm"]
    # 3D: modo leve por padrão sem placa de vídeo, volume de 105 M de voxels reduzido
    assert page.evaluate("localStorage.getItem('catstudio.desempenho')") is None
    page.wait_for_timeout(3000)
    std, _ = _image_std(page.get_by_test_id("vtk-view vtk-volume-view").first.screenshot())
    assert std > 5, "vista 3D vazia"
    # o seletor de desempenho fica no painel de renderização e guarda a escolha
    page.get_by_text("Renderização", exact=True).first.click()
    page.get_by_test_id("performance-select").wait_for(timeout=20000)
    page.get_by_test_id("performance-equilibrado").click()
    assert page.evaluate("localStorage.getItem('catstudio.desempenho')") == "equilibrado"
    page.get_by_test_id("performance-leve").click()
    assert page.evaluate("localStorage.getItem('catstudio.desempenho')") == "leve"
    session.wait_idle()
    std, _ = _image_std(page.get_by_test_id("vtk-view vtk-volume-view").first.screenshot())
    assert std > 5, "vista 3D vazia depois de trocar o desempenho"
    assert not session.errors, session.errors


@needs_big
def test_triagem_cancelar_volta_para_a_tela_inicial(session):
    page = session.page
    _open_big(session)
    page.get_by_test_id("series-triage-cancel").click()
    page.get_by_test_id("welcome-open-folder").wait_for(timeout=20000)
    assert not session.state()
    assert not session.errors, session.errors


@needs_big
def test_exame_completo_so_carrega_a_serie_exibida(session):
    """Pasta com 7 séries (~2000 imagens, ~1 GB): o VolView original derrubava a
    aba por falta de memória. Aqui só a série exibida é carregada, e trocar de
    série libera a anterior."""
    page = session.page
    cdp = page.context.new_cdp_session(page)
    cdp.send("Performance.enable")
    heap = []

    def sample():
        m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        heap.append(m.get("JSHeapUsedSize", 0) / 1048576)

    _open_big(session, sample)
    page.get_by_test_id("series-triage-all").click()
    t0 = time.time()
    while not session.state() and time.time() - t0 < 120:
        sample()
        page.wait_for_timeout(500)
    session.wait_loaded(timeout=400)
    st = session.state()
    assert len(st) == 7
    assert sum(x["st"] == "complete" for x in st) == 1, st
    assert max(heap) < 400, f"heap JS chegou a {max(heap):.0f} MB na importação"
    # abre primeiro a série sugerida, não a que tem mais imagens
    assert [d["desc"] for d in _descriptions(session) if d["shown"]] == ["Fase arterial 1 mm"]
    first = next(x["id"] for x in st if x["shown"])
    # trocar de série: a nova vai para todas as vistas e a anterior sai da memória
    # WebGL por software: trocar a série re-renderiza tudo e trava a página por um tempo
    page.locator(".volume-card:not(.volume-card-active)").first.click(timeout=300000)
    page.wait_for_timeout(2000)
    session.wait_loaded(timeout=400)
    st = {x["id"]: x for x in session.state()}
    shown = [i for i, x in st.items() if x["shown"]]
    assert len(shown) == 1 and shown[0] != first, shown
    assert st[first]["st"] == "incomplete"
    assert sum(x["st"] == "complete" for x in st.values()) == 1
    assert not session.errors, session.errors


# ------------------------------------------------------------------ atalhos, MIP e MinIP

def _views(page):
    """Nome da vista → id."""
    return dict(page.evaluate(f"() => Object.values({PINIA}._s.get('view').viewByID).map(v => [v.name, v.id])"))


def _window(page, view_id):
    return page.evaluate(f"""() => {{ const p = {PINIA}; const img = [...p._s.get('image-cache').imageIds][0];
        const c = p._s.get('windowing').getConfig('{view_id}', img); return [Math.round(c.width), Math.round(c.level)]; }}""")


def _go_to_z(page, view_id, z_mm):
    """Leva a vista axial ao corte mais próximo de z (mm, LPS)."""
    page.evaluate(f"""() => {{ const p = {PINIA}; const cache = p._s.get('image-cache');
        const id = [...cache.imageIds][0]; const img = cache.getVtkImageData(id);
        const k = Math.round(img.worldToIndex([0, 0, {z_mm}], [0, 0, 0])[2]);
        p._s.get('viewSlice').updateConfig('{view_id}', id, {{ slice: k }}); }}""")
    page.wait_for_timeout(600)


def _white_pixels(png_bytes):
    from PIL import Image
    im = np.asarray(Image.open(io.BytesIO(png_bytes)).convert("L"))
    h, w = im.shape
    # sem as bordas, onde ficam os textos e o controle da espessura
    return int((im[60:h - 60, 40:w - 40] > 235).sum())


def test_atalhos_de_janela_regua_e_reset(session):
    page = session.page
    session.open_files(files_of("ax_main"))
    views = _views(page)
    axial = page.get_by_test_id("vtk-view vtk-two-view").first
    axial.click(position={"x": 200, "y": 200})
    padrao = _window(page, views["Axial"])
    esperado = [(1500, -600), (350, 40), (400, 50), (1800, 400), (80, 40), (1000, -426)]
    for tecla, (largura, nivel) in zip("123456", esperado):
        page.keyboard.press(tecla)
        page.wait_for_timeout(200)
        # a janela vale para as três vistas 2D
        for nome in ("Axial", "Coronal", "Sagittal"):
            assert _window(page, views[nome]) == [largura, nivel], (tecla, nome)
    page.keyboard.press("d")
    page.wait_for_timeout(200)
    assert page.evaluate(f"() => {PINIA}._s.get('tool').currentTool") == "Ruler"
    page.keyboard.press("m")
    page.wait_for_timeout(300)
    assert page.evaluate(f"() => __catstudio.slab('{views['Axial']}').mode") == "max"
    page.keyboard.press("x")
    page.wait_for_timeout(500)
    assert page.evaluate(f"() => __catstudio.slab('{views['Axial']}').mode") == "off"
    assert _window(page, views["Axial"]) == padrao
    assert not session.errors, session.errors


def test_mip_mostra_o_que_esta_fora_do_corte(session):
    """Cubo de 500 HU (z de 60 a 80 mm): no corte fino em z = 90 ele não
    aparece, nem no MIP de 10 mm (z de 85 a 95); no MIP de 30 mm (z de 75 a
    105) aparece."""
    page = session.page
    session.open_files(files_of("ax_main"))
    views = _views(page)
    axial = page.get_by_test_id("vtk-view vtk-two-view").first
    axial.click(position={"x": 200, "y": 200})
    page.keyboard.press("2")  # mediastino: só o que é denso fica branco
    _go_to_z(page, views["Axial"], 90)
    fino = _white_pixels(axial.screenshot())
    page.keyboard.press("m")
    page.wait_for_timeout(400)
    assert page.get_by_test_id("slab-mode").first.inner_text() == "MIP"
    page.wait_for_timeout(800)
    mip10 = _white_pixels(axial.screenshot())
    for _ in range(6):  # 10 → 30 mm
        page.get_by_label("Aumentar espessura").first.click()
    assert page.get_by_test_id("slab-thickness").first.inner_text() == "30 mm"
    page.wait_for_timeout(800)
    mip30 = _white_pixels(axial.screenshot())
    assert abs(mip10 - fino) < 0.1 * fino + 50, (fino, mip10)
    assert mip30 > fino + 300, (fino, mip30)
    # desligar volta ao corte fino
    page.keyboard.press("m")
    page.wait_for_timeout(800)
    assert page.get_by_test_id("slab-control").count() == 0
    assert abs(_white_pixels(axial.screenshot()) - fino) < 0.1 * fino + 50
    assert not session.errors, session.errors


def test_minip_apaga_o_que_e_denso_dentro_da_fatia(session):
    """No corte pelo centro do marcador (raio 12 mm, dentro do pulmão) ele
    aparece; no MinIP de 30 mm some, porque a fatia inclui pulmão acima e
    abaixo dele."""
    page = session.page
    session.open_files(files_of("ax_main"))
    views = _views(page)
    axial = page.get_by_test_id("vtk-view vtk-two-view").first
    axial.click(position={"x": 200, "y": 200})
    page.keyboard.press("2")
    _go_to_z(page, views["Axial"], 40)
    fino = _white_pixels(axial.screenshot())
    page.keyboard.press("n")
    page.wait_for_timeout(400)
    assert page.get_by_test_id("slab-mode").first.inner_text() == "MinIP"
    for _ in range(8):  # 5 → 7,5 … 20 → 25 → 30 mm
        page.get_by_label("Aumentar espessura").first.click()
    assert page.get_by_test_id("slab-thickness").first.inner_text() == "30 mm"
    page.wait_for_timeout(800)
    minip = _white_pixels(axial.screenshot())
    assert minip < fino - 300, (fino, minip)
    assert not session.errors, session.errors


# ------------------------------------------------------------------ trava de segurança do 3D

LONG_TASKS = """window.__long = [];
new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration))))
  .observe({entryTypes: ['longtask']});"""


def _long_tasks(page):
    return page.evaluate("() => { const l = window.__long; window.__long = []; return l; }")


@pytest.mark.parametrize("modo", ["leve", "maximo"])
def test_3d_nao_prende_a_pagina(browser, url, modo):
    """Com WebGL por software o quadro 3D em resolução total leva segundos
    (como numa placa de vídeo fraca com o cinematográfico ligado). A trava tem
    de manter cada quadro curto: girando, e mexendo nos ajustes."""
    s = Session(browser, url, init_script=f"localStorage.setItem('catstudio.desempenho', '{modo}');" + LONG_TASKS)
    try:
        page = s.page
        s.open_files(files_of("ax_main"))
        page.wait_for_timeout(3000)
        vid = _views(page)["Volume"]
        _long_tasks(page)  # descarta o carregamento

        view = page.get_by_test_id("vtk-view vtk-volume-view").first
        box = view.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        for i in range(12):
            page.mouse.move(cx + 10 * i, cy + 4 * i)
            page.wait_for_timeout(40)
        page.mouse.up()
        page.wait_for_timeout(4000)
        girando = _long_tasks(page)

        # arrastar controles do cinematográfico: 15 mudanças seguidas
        page.evaluate(f"""async () => {{ const st = {PINIA}._s.get('volumeColoring');
            const img = Object.keys(st.configs['{vid}'])[0];
            for (let i = 0; i < 15; i++) {{
              st.updateCVRParameters('{vid}', img, {{ ambient: 0.1 + i * 0.02, laoKernelSize: 5 + i, volumeQuality: 1 + (i % 4) }});
              await new Promise(r => setTimeout(r, 60));
            }} }}""")
        page.wait_for_timeout(6000)
        ajustando = _long_tasks(page)

        estado = page.evaluate(f"() => __catstudio.guard('{vid}')")
        limite = 2.5 * page.evaluate("() => __catstudio.FRAME_BUDGET_MS")
        assert max(girando + [0]) < limite, girando
        assert max(ajustando + [0]) < limite, ajustando
        assert not estado["refining"]
        if estado["limited"]:
            assert estado["scale"] > 1 and estado["fullEstimateMs"] > 0
            assert page.get_by_test_id("render-guard-badge").count() == 1
        std, _ = _image_std(view.screenshot())
        assert std > 5, "vista 3D vazia"
        assert not s.errors, s.errors
    finally:
        s.close()


# ------------------------------------------------------------------ diretor de arte

def _director(session):
    page = session.page
    session.open_files(files_of("ax_main"))
    page.get_by_test_id("open-director-mode").click()
    page.get_by_test_id("director-mode").wait_for(timeout=20000)
    page.wait_for_function(
        "() => !document.querySelector('[data-testid=director-text] textarea').disabled", timeout=60000)
    return page


def _ask_director(page, pedido):
    page.locator("[data-testid=director-text] textarea").first.fill(pedido)
    page.get_by_test_id("director-go").click()
    page.wait_for_timeout(300)
    page.wait_for_function(
        "() => document.querySelector('[data-testid=director-busy]').textContent.trim() === ''", timeout=60000)
    entendi = page.get_by_test_id("director-understood")
    return entendi.inner_text() if entendi.count() else ""


def _cut_pixels(page):
    """Fração de pixels claros e escuros do corte desenhado (sem a moldura)."""
    return page.evaluate("""() => {
        const c = document.querySelector('[data-testid=director-cut]');
        const d = c.getContext('2d').getImageData(40, 40, c.width - 80, c.height - 120).data;
        let bright = 0, dark = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] > 200) bright++; if (d[i] < 40) dark++; }
        return { width: c.width, height: c.height, bright: bright / (d.length / 4), dark: dark / (d.length / 4) };
    }""")


def test_diretor_de_arte_faz_o_corte_pedido(session):
    page = _director(session)
    # sem nuvem configurada: nada sai do computador
    assert "Interpretador local" in page.get_by_test_id("director-engine").inner_text()
    assert not session.external, session.external

    entendi = _ask_director(
        page, "corte no plano sagital linha hemiclavicular esquerda pra mostrar as estruturas torácicas e hérnia abdominal")
    assert "Corte sagital na linha hemiclavicular esquerda (estimada" in entendi
    assert "janela de partes moles" in entendi
    assert "não medida na clavícula" in entendi
    corte = _cut_pixels(page)
    # o corte passa pelo pulmão esquerdo: muito ar (escuro) e parede (cinza), sem ficar vazio
    assert corte["width"] > 600 and corte["height"] > 600
    assert corte["dark"] > 0.3 and corte["dark"] < 0.95, corte

    # ajuste por texto: mantém o plano e a referência
    entendi = _ask_director(page, "2 cm mais lateral, mip de 20 mm, fundo branco")
    assert "hemiclavicular esquerda" in entendi and "20 mm para a esquerda" in entendi and "MIP de 20 mm" in entendi
    borda = page.evaluate("""() => { const c = document.querySelector('[data-testid=director-cut]');
        return Array.from(c.getContext('2d').getImageData(3, 3, 1, 1).data.slice(0, 3)); }""")
    assert borda == [255, 255, 255]

    # em 3D: a face do corte sai colorida (tecido avermelhado), não em cinza
    entendi = _ask_director(page, "mas em 3d, fundo preto")
    assert "reconstrução 3D recortada no plano, 160 mm de profundidade" in entendi
    cores = page.evaluate("""() => { const c = document.querySelector('[data-testid=director-cut]');
        const d = c.getContext('2d').getImageData(40, 40, c.width - 80, c.height - 120).data;
        let red = 0, lit = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i+1] + d[i+2] > 60) lit++; if (d[i] > d[i+2] + 25) red++; }
        return { lit: lit / (d.length / 4), red: red / (d.length / 4) }; }""")
    assert cores["lit"] > 0.3 and cores["red"] > 0.2, cores
    _ask_director(page, "corte fino, fundo branco")

    # pedido sem sentido: avisa e não mexe na imagem
    antes = page.get_by_test_id("director-understood").inner_text()
    _ask_director(page, "faz uma coisa bonita")
    assert "Não entendi" in " ".join(n.inner_text() for n in page.get_by_test_id("director-note").all())
    assert page.get_by_test_id("director-understood").inner_text() == antes

    # clicar no localizador passa o corte pelo ponto; desfazer volta
    loc = page.get_by_test_id("director-locator")
    caixa = loc.bounding_box()
    loc.click(position={"x": caixa["width"] * 0.3, "y": caixa["height"] * 0.5})
    page.wait_for_timeout(300)
    page.wait_for_function(
        "() => document.querySelector('[data-testid=director-busy]').textContent.trim() === ''", timeout=60000)
    assert "no ponto marcado" in page.get_by_test_id("director-understood").inner_text()
    page.get_by_test_id("director-undo").click()
    page.wait_for_timeout(1500)
    assert page.get_by_test_id("director-understood").inner_text() == antes

    with page.expect_download(timeout=20000) as dl:
        page.get_by_test_id("director-png").click()
    assert dl.value.suggested_filename == "corte-sagital.png"
    assert not session.external, session.external
    assert not session.errors, session.errors


def test_diretor_de_arte_usa_a_ia_quando_a_nuvem_esta_configurada(browser, url):
    """A configuração de nuvem do CineDeck (mesma origem) liga a IA. O que sai
    é só texto e geometria; a receita que volta é conferida; se a nuvem falha,
    cai no interpretador local com aviso."""
    s = Session(browser, url, init_script="""localStorage.setItem('cinedeck_nuvem',
        JSON.stringify({ia: 'https://ia.exemplo.test', key: 'chave-de-teste'}));""")
    try:
        enviados = []

        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*",
                "access-control-allow-methods": "POST, OPTIONS"}

        def responder(route):
            if route.request.method == "OPTIONS":
                route.fulfill(status=204, headers=cors)
                return
            enviados.append((route.request.headers.get("x-cinedeck-key"), route.request.post_data_json))
            if len(enviados) == 1:
                route.fulfill(status=200, headers={**cors, "content-type": "application/json"}, body=json.dumps({
                    "receita": {"plano": "coronal", "referencia": "axilar-media", "projecao": "mip",
                                "espessura": 99999, "janela": "pulmao", "titulo": "<img src=x onerror=alert(1)>"},
                    "comentario": "Coronal espesso para ver os dois pulmões."}))
            else:
                route.fulfill(status=404, headers=cors, body="sem rota")

        s.page.route("https://ia.exemplo.test/**", responder)
        page = _director(s)
        assert "IA pela nuvem do CineDeck" in page.get_by_test_id("director-engine").inner_text()

        entendi = _ask_director(page, "quero ver os dois pulmões de frente, paciente 123456789")
        chave, corpo = enviados[0]
        assert chave == "chave-de-teste"
        assert sorted(corpo.keys()) == ["atual", "exame", "pedido"]
        assert "123456789" not in corpo["pedido"] and "[número]" in corpo["pedido"]
        assert all(isinstance(v, (int, float, str, list)) for v in corpo["exame"].values())
        assert len(json.dumps(corpo)) < 1500, "só texto e geometria devem sair"
        assert "IA:" in entendi and "Corte coronal na linha axilar média" in entendi
        assert "MIP de 300 mm" in entendi  # espessura absurda limitada
        assert "Coronal espesso para ver os dois pulmões." in entendi
        assert _cut_pixels(page)["dark"] < 0.98

        # nuvem sem a rota do diretor: interpretador local, com aviso
        entendi = _ask_director(page, "janela de osso")
        assert "janela de osso" in entendi
        notas = " ".join(n.inner_text() for n in page.get_by_test_id("director-note").all())
        assert "ainda não tem o diretor de arte" in notas and "interpretador local" in notas
        assert not s.errors, s.errors
    finally:
        s.close()


# ------------------------------------------------------------------ caixa de corte do 3D

def test_caixa_de_corte_do_3d_responde_ao_arrasto(session):
    """Arrastar uma alça da caixa de corte na vista 3D tem de mudar o corte.
    (Não mudava: o volume era desenhado na passada de seleção dos widgets e
    apagava as alças do buffer onde o mouse as procura.)"""
    from PIL import Image
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(3000)
    page.evaluate(f"() => {PINIA}._s.get('tool').setCurrentTool('Crop')")
    page.wait_for_timeout(4000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    corte = f"""() => {{ const p = {PINIA}; const id = [...p._s.get('image-cache').imageIds][0];
        return JSON.parse(JSON.stringify(p._s.get('crop').croppingByImageID[id])); }}"""
    antes = page.evaluate(corte)

    # as alças são as bolas verdes; pega a mais à esquerda na altura do meio
    im = np.asarray(Image.open(io.BytesIO(view.screenshot())).convert("RGB")).astype(int)
    verde = (im[..., 1] > 200) & (im[..., 0] < 90) & (im[..., 2] < 90)
    ys, xs = np.nonzero(verde)
    assert len(xs) > 500, "alças da caixa de corte não apareceram"
    meio = int(np.median(ys))
    faixa = np.abs(ys - meio) < 6
    x0 = int(xs[faixa].min()) + 8
    caixa = view.bounding_box()
    page.mouse.move(caixa["x"] + x0, caixa["y"] + meio)
    page.wait_for_timeout(500)
    page.mouse.down()
    for k in range(1, 11):
        page.mouse.move(caixa["x"] + x0 + 12 * k, caixa["y"] + meio)
        page.wait_for_timeout(120)
    page.mouse.up()
    page.wait_for_timeout(2500)
    depois = page.evaluate(corte)
    assert depois != antes, (antes, depois)
    mudou = [eixo for eixo in antes if antes[eixo] != depois[eixo]]
    assert len(mudou) == 1, mudou  # uma face só
    assert not session.errors, session.errors


# ------------------------------------------------------------------ esculpir o 3D

def _gray_3d(page, view):
    from PIL import Image
    page.wait_for_timeout(2500)
    return np.asarray(Image.open(io.BytesIO(view.screenshot())).convert("L")).astype(float)


def _sculpt_status(page):
    return page.get_by_test_id("sculpt-status").inner_text()


def _sculpt_shot(page, view):
    """Fotografa o 3D com o painel de escultura fechado (ele cobre a vista)."""
    page.get_by_test_id("sculpt-close").click()
    imagem = _gray_3d(page, view)
    page.get_by_test_id("open-sculpt").click()
    return imagem


def test_esculpir_o_3d_com_laco_clique_e_desfazer(session):
    """Laço apaga só a região contornada, clique apaga a estrutura inteira,
    desfazer e restaurar devolvem o volume; arrastar no modo clique gira."""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    page.get_by_test_id("open-sculpt").click()
    inteiro = _sculpt_shot(page, view)
    meio = inteiro.shape[1] // 2
    # só a faixa do meio: em cima e embaixo ficam os textos da vista
    claros = lambda im, cols: int((im[60:-60, cols] > 60).sum())
    direita, esquerda = slice(meio + 6, None), slice(0, meio - 6)
    assert claros(inteiro, direita) > 500 and claros(inteiro, esquerda) > 500

    # laço em volta da metade direita da vista
    caixa = view.bounding_box()
    x0, y0, w, h = caixa["x"], caixa["y"], caixa["width"], caixa["height"]
    page.get_by_test_id("sculpt-lasso-remove").click()
    page.mouse.move(x0 + w / 2, y0 + 5)
    page.mouse.down()
    for x, y in [(x0 + w - 5, y0 + 5), (x0 + w - 5, y0 + h - 5),
                 (x0 + w / 2, y0 + h - 5), (x0 + w / 2, y0 + 5)]:
        page.mouse.move(x, y, steps=4)
    page.mouse.up()
    page.wait_for_timeout(1500)
    assert "apagada" in _sculpt_status(page)
    cortado = _sculpt_shot(page, view)
    assert claros(cortado, direita) < 0.1 * claros(inteiro, direita)
    assert claros(cortado, esquerda) > 0.9 * claros(inteiro, esquerda)

    page.get_by_test_id("sculpt-undo").click()
    desfeito = _sculpt_shot(page, view)
    assert abs(claros(desfeito, direita) - claros(inteiro, direita)) < 80

    # clique na esfera da direita: some a esfera inteira, o resto fica
    ys, xs = np.nonzero(desfeito[60:-60, meio + 40:] > 120)
    page.get_by_test_id("sculpt-pick-remove").click()
    page.mouse.click(x0 + meio + 40 + float(np.median(xs)), y0 + 60 + float(np.median(ys)))
    page.wait_for_timeout(2000)
    assert "Estrutura apagada" in _sculpt_status(page), _sculpt_status(page)
    sem_esfera = _sculpt_shot(page, view)
    assert claros(sem_esfera, slice(meio + 40, None)) < 60
    assert claros(sem_esfera, esquerda) > 0.9 * claros(inteiro, esquerda)

    # no modo clique, arrastar continua girando e não apaga nada
    page.get_by_test_id("sculpt-pick-remove").click()
    escondidos = lambda: page.evaluate(f"""() => __catstudio.sculpt(
        [...{PINIA}._s.get('image-cache').imageIds][0]).hiddenVoxels""")
    antes = escondidos()
    assert antes > 0
    page.mouse.move(x0 + w / 2, y0 + h / 2)
    page.mouse.down()
    page.mouse.move(x0 + w / 2 + 80, y0 + h / 2 + 20, steps=5)
    page.mouse.up()
    girado = _sculpt_shot(page, view)
    assert np.abs(girado - sem_esfera).mean() > 1.0
    assert escondidos() == antes

    page.get_by_test_id("sculpt-restore").click()
    assert escondidos() == 0
    assert not session.errors, session.errors


# ------------------------------------------------------------------ vistas pretas e tela inicial

def test_vistas_voltam_depois_que_a_placa_derruba_o_contexto(session):
    """Perda do contexto WebGL deixava todas as vistas pretas, sem volta.
    Agora as vistas são recriadas sozinhas."""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    antes = int((_gray_3d(page, view) > 60).sum())
    assert antes > 1000
    assert page.evaluate("() => __catstudio.loseGlContext()")
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    depois = int((_gray_3d(page, view) > 60).sum())
    assert depois > 0.8 * antes, (antes, depois)
    assert any("placa de vídeo" in m for m in session.messages()), session.messages()


def test_botao_tela_inicial_fecha_o_exame(session):
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(3000)
    page.get_by_test_id("go-home").click()
    page.get_by_test_id("go-home-confirm").click()
    page.wait_for_timeout(1500)
    estado = page.evaluate(f"""() => {{ const p = {PINIA};
        return [p._s.get('images').idList.length, Object.keys(p._s.get('dicom').volumeInfo).length]; }}""")
    assert estado == [0, 0], estado
    assert page.get_by_test_id("go-home").count() == 0
    # e dá para abrir outro exame em seguida
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(4000)
    assert page.get_by_test_id("vtk-view vtk-volume-view").count() == 1
    assert not session.errors, session.errors


def test_osso_translucido_escondido_e_crescer_segurando(session):
    """Detectar osso, deixá-lo translúcido e escondê-lo; e a ferramenta de
    crescer enquanto o botão fica apertado. (No fantoma, a "estrutura
    heterogênea" que a heurística chama de osso é a esfera da direita.)"""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    page.get_by_test_id("open-sculpt").click()
    inteiro = _sculpt_shot(page, view)
    meio = inteiro.shape[1] // 2
    esfera = lambda im, corte: int((im[60:-60, meio + 40:] > corte).sum())
    assert esfera(inteiro, 60) > 200

    page.get_by_test_id("sculpt-bone-detect").click()
    page.wait_for_timeout(2500)
    assert "Osso: 1 estrutura" in _sculpt_status(page), _sculpt_status(page)
    page.get_by_test_id("sculpt-bone-opacity").fill("30")
    translucido = _sculpt_shot(page, view)
    assert esfera(translucido, 60) < 0.5 * esfera(inteiro, 60)   # mais fraca…
    assert esfera(translucido, 25) > 0.6 * esfera(inteiro, 25)   # …mas ainda lá
    page.get_by_test_id("sculpt-bone-toggle").click()
    assert page.get_by_test_id("sculpt-bone-label").inner_text() == "escondido"
    escondido = _sculpt_shot(page, view)
    assert esfera(escondido, 25) == 0
    esquerda = slice(0, meio - 6)
    resto = lambda im: int((im[60:-60, esquerda] > 60).sum())
    assert resto(escondido) > 0.9 * resto(inteiro)                # o resto fica
    page.get_by_test_id("sculpt-bone-forget").click()
    assert esfera(_sculpt_shot(page, view), 60) > 0.9 * esfera(inteiro, 60)

    # crescer: segura em cima do cilindro; sobra só o pedaço que cresceu
    caixa = view.bounding_box()
    page.get_by_test_id("sculpt-grow-keep").click()
    page.mouse.move(caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] * 0.3)
    page.mouse.down()
    page.wait_for_timeout(1200)
    assert "Crescendo" in _sculpt_status(page), _sculpt_status(page)
    page.mouse.up()
    page.wait_for_timeout(500)
    assert "Ficou só o que cresceu" in _sculpt_status(page), _sculpt_status(page)
    cresceu = _sculpt_shot(page, view)
    claros = int((cresceu[60:-60] > 60).sum())
    assert 0 < claros < 0.6 * int((inteiro[60:-60] > 60).sum())
    assert esfera(cresceu, 25) == 0
    page.get_by_test_id("sculpt-undo").click()
    assert esfera(_sculpt_shot(page, view), 60) > 0.9 * esfera(inteiro, 60)
    assert not session.errors, session.errors


def test_presets_de_luz_fundo_e_exportacao_em_alta(session, tmp_path):
    from PIL import Image
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    padrao = _gray_3d(page, view)
    page.get_by_text("RENDERIZAÇÃO").first.click()
    page.get_by_text("Iluminação e fundo").first.click()
    page.get_by_test_id("light-preset-dramatico").click()
    dramatico = _gray_3d(page, view)
    miolo = (slice(60, -60), slice(40, -40))
    mudou = np.abs(dramatico[miolo] - padrao[miolo]).mean()
    assert mudou > 0.5
    # "igual ao padrão" com folga: no vídeo por software a trava do 3D pode
    # fechar o quadro num degrau de resolução diferente a cada vez
    igual = lambda im: np.abs(im[miolo] - padrao[miolo]).mean() < 0.6 * mudou
    page.get_by_test_id("light-background-ffffff").click()
    branco = _gray_3d(page, view)
    assert branco[100, 40] > 240 and padrao[100, 40] < 15
    page.get_by_test_id("light-preset-padrao").click()
    page.get_by_test_id("light-background-000000").click()
    de_volta = _gray_3d(page, view)
    assert igual(de_volta)

    caixa = view.bounding_box()
    with page.expect_download(timeout=120000) as dl:
        page.get_by_test_id("export-3d-menu").first.click()
        page.get_by_test_id("export-3d-2x").click()
    arquivo = tmp_path / dl.value.suggested_filename
    dl.value.save_as(arquivo)
    largura, altura = Image.open(arquivo).size
    assert abs(largura - 2 * caixa["width"]) <= 4 and abs(altura - 2 * caixa["height"]) <= 4
    # e a vista volta ao tamanho normal depois
    page.wait_for_timeout(2500)
    assert igual(_gray_3d(page, view))
    assert not session.errors, session.errors


def _opacity_curve(page):
    return page.evaluate(f"""() => {{ const p = {PINIA};
        const id = [...p._s.get('image-cache').imageIds][0];
        const view = Object.values(p._s.get('view').viewByID).find(v => v.type === '3D');
        const f = p._s.get('volumeColoring').getConfig(view.id, id).opacityFunction;
        return [f.shift, f.shiftAlpha]; }}""")


def test_dois_botoes_mexem_na_janela_do_3d_e_tirar_mesa(session):
    """Esquerdo + direito juntos e arrastar muda a curva de opacidade (a
    "janela" do 3D) sem girar a câmera; e "Tirar mesa" deixa só a maior
    estrutura do exame."""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    caixa = view.bounding_box()
    cx, cy = caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] / 2
    camera = lambda: page.evaluate(f"""() => {{ const p = {PINIA};
        const view = Object.values(p._s.get('view').viewByID).find(v => v.type === '3D');
        const id = [...p._s.get('image-cache').imageIds][0];
        return JSON.stringify(p._s.get('viewCamera').getConfig(view.id, id) ?? null); }}""")
    antes = _opacity_curve(page)
    camera_antes = camera()
    page.mouse.move(cx, cy)
    page.mouse.down(button="left")
    page.mouse.down(button="right")
    page.mouse.move(cx + 60, cy + 90, steps=6)
    assert "Janela 3D" in page.get_by_test_id("window-drag-badge").inner_text()
    page.mouse.up(button="right")
    page.mouse.move(cx + 120, cy + 140, steps=4)   # com um botão só, nada acontece
    page.mouse.up(button="left")
    page.wait_for_timeout(1500)
    depois = _opacity_curve(page)
    assert abs(depois[0] - antes[0] - 90 / 1500) < 0.01, (antes, depois)
    assert abs(depois[1] - antes[1] + 60 / 500) < 0.02, (antes, depois)
    assert camera() == camera_antes
    assert page.get_by_test_id("window-drag-badge").count() == 0

    # tirar mesa: no fantoma tudo o que aparece no 3D está dentro do corpo,
    # então o corte esconde o ar de fora e não pode apagar nada visível
    page.mouse.move(cx, cy)
    page.mouse.down(button="left")
    page.mouse.down(button="right")
    page.mouse.move(cx - 60, cy - 90, steps=6)     # devolve a janela
    page.mouse.up(button="right")
    page.mouse.up(button="left")
    page.get_by_test_id("open-sculpt").click()
    inteiro = _sculpt_shot(page, view)
    escondidos = lambda: page.evaluate(f"""() => __catstudio.sculpt(
        [...{PINIA}._s.get('image-cache').imageIds][0]).hiddenVoxels""")
    page.get_by_test_id("sculpt-table").click()
    page.wait_for_timeout(3000)
    assert "fora do corpo" in _sculpt_status(page), _sculpt_status(page)
    assert escondidos() > 100000
    sem_mesa = _sculpt_shot(page, view)
    claros = lambda im: int((im[60:-60] > 60).sum())
    assert abs(claros(sem_mesa) - claros(inteiro)) < 0.05 * claros(inteiro)
    page.get_by_test_id("sculpt-undo").click()
    assert escondidos() == 0
    assert not session.errors, session.errors


def test_girar_a_caixa_de_corte_e_borracha(session):
    """"Girar caixa": arrastar gira a caixa de corte (o exame e a câmera ficam
    parados) e o corte passa a ser oblíquo; "Alinhar" desfaz. E a borracha
    apaga a superfície por onde passa."""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(4000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    caixa = view.bounding_box()
    cx, cy = caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] / 2
    page.evaluate(f"() => {PINIA}._s.get('tool').setCurrentTool('Crop')")
    # caixa mais baixa que o exame: corta as pontas do cilindro
    page.evaluate(f"""() => {{ const p = {PINIA}; const crop = p._s.get('crop');
        const id = [...p._s.get('image-cache').imageIds][0];
        const c = JSON.parse(JSON.stringify(crop.croppingByImageID[id]));
        const mid = (c.Axial[0] + c.Axial[1]) / 2, q = (c.Axial[1] - c.Axial[0]) / 4;
        crop.setCropping(id, {{ ...c, Axial: [mid - q, mid + q] }}); }}""")
    estado = lambda: page.evaluate(f"""() => {{ const p = {PINIA};
        const id = [...p._s.get('image-cache').imageIds][0];
        const view = Object.values(p._s.get('view').viewByID).find(v => v.type === '3D');
        return [JSON.stringify(p._s.get('crop').croppingByImageID[id]),
                JSON.stringify(p._s.get('viewCamera').getConfig(view.id, id) ?? null)]; }}""")
    # sem as alças verdes da caixa, só o volume
    volume = lambda: (lambda im: (im[..., 0] > 90) & (im[..., 1] < 235))(
        np.asarray(__import__("PIL.Image", fromlist=["x"]).open(io.BytesIO(view.screenshot())).convert("RGB")).astype(int))
    page.wait_for_timeout(3000)
    alinhada = volume()
    antes = estado()
    assert page.get_by_test_id("crop-rotate-align").count() == 0

    page.get_by_test_id("crop-rotate-toggle").click()
    page.mouse.move(cx + 100, cy + 120)
    page.mouse.down()
    page.mouse.move(cx + 100, cy + 40, steps=8)
    page.mouse.up()
    page.wait_for_timeout(3000)
    girada = volume()
    assert estado() == antes                 # nem a caixa mudou de tamanho, nem a câmera girou
    assert (girada != alinhada).mean() > 0.002   # mas o corte agora é outro

    page.get_by_test_id("crop-rotate-toggle").click()
    page.get_by_test_id("crop-rotate-align").click()
    page.wait_for_timeout(3000)
    assert (volume() != alinhada).mean() < 0.3 * (girada != alinhada).mean()
    assert page.get_by_test_id("crop-rotate-align").count() == 0

    # borracha na esfera da direita
    page.evaluate(f"() => {PINIA}._s.get('tool').setCurrentTool('WindowLevel')")
    page.evaluate(f"""() => {{ const p = {PINIA}; const id = [...p._s.get('image-cache').imageIds][0];
        p._s.get('crop').resetCropping(id); }}""")
    page.get_by_test_id("open-sculpt").click()
    inteiro = _sculpt_shot(page, view)
    meio = inteiro.shape[1] // 2
    ys, xs = np.nonzero(inteiro[60:-60, meio + 40:] > 120)
    ex, ey = caixa["x"] + meio + 40 + float(np.median(xs)), caixa["y"] + 60 + float(np.median(ys))
    page.get_by_test_id("sculpt-brush-remove").click()
    page.get_by_test_id("sculpt-brush-size").fill("12")
    page.mouse.move(ex - 6, ey)
    page.mouse.down()
    for passo in range(8):
        page.mouse.move(ex - 6 + 2 * passo, ey + (passo % 2))
        page.wait_for_timeout(130)
    page.mouse.up()
    page.wait_for_timeout(800)
    assert "Borracha:" in _sculpt_status(page), _sculpt_status(page)
    apagado = _sculpt_shot(page, view)
    esfera = lambda im: int((im[60:-60, meio + 40:] > 60).sum())
    assert esfera(apagado) < 0.5 * esfera(inteiro)
    page.get_by_test_id("sculpt-undo").click()
    assert esfera(_sculpt_shot(page, view)) > 0.9 * esfera(inteiro)
    assert not session.errors, session.errors


def _rgb_3d(page, view):
    from PIL import Image
    page.wait_for_timeout(2500)
    im = np.asarray(Image.open(io.BytesIO(view.screenshot())).convert("RGB")).astype(float)
    return im[60:-60, 40:-40]


def test_cores_por_tecido_paleta_edicao_e_dois_botoes(session):
    """Escolher uma paleta por tecido recolore o 3D; editar um ponto muda a
    imagem na hora; salvar cria uma paleta própria; e os dois botões do mouse
    deslocam a paleta inteira."""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    page.get_by_text("RENDERIZAÇÃO").first.click()
    page.get_by_text("Cores por tecido").first.click()
    # vermelho menos azul, só nos pixels com alguma coisa
    vermelhidao = lambda im: float((im[..., 0] - im[..., 2])[im.sum(axis=2) > 90].mean())
    claros = lambda im: int((im.sum(axis=2) > 90).sum())

    page.get_by_test_id("palette-vascular").click()
    vascular = _rgb_3d(page, view)
    assert vermelhidao(vascular) > 60, vermelhidao(vascular)
    page.get_by_test_id("palette-vidro").click()
    vidro = _rgb_3d(page, view)
    assert vermelhidao(vidro) < -30, vermelhidao(vidro)

    # editar: o ponto "Contraste" da paleta azul vira verde e opaco
    ponto = page.get_by_test_id("palette-stop-1")
    ponto.locator("input[type=color]").fill("#00ff00")
    ponto.locator("input[type=range]").fill("100")
    editado = _rgb_3d(page, view)
    verde = lambda im: float((im[..., 1] - im[..., 0])[im.sum(axis=2) > 90].mean())
    assert verde(editado) > verde(vidro) + 20, (verde(vidro), verde(editado))

    page.get_by_test_id("palette-title").fill("Verde de teste")
    page.get_by_test_id("palette-save").click()
    assert page.get_by_role("button", name="Verde de teste").count() == 1
    assert page.get_by_test_id("palette-delete").count() == 1

    # dois botões: arrastar para cima traz tecidos menos densos (mais coisa na tela)
    caixa = view.bounding_box()
    cx, cy = caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] / 2
    page.get_by_test_id("palette-vascular").click()
    antes = _rgb_3d(page, view)
    page.mouse.move(cx + 120, cy + 150)
    page.mouse.down(button="left")
    page.mouse.down(button="right")
    page.mouse.move(cx + 120, cy + 50, steps=6)      # -200 HU
    page.mouse.up(button="right")
    page.mouse.up(button="left")
    depois = _rgb_3d(page, view)
    assert claros(depois) > 1.5 * claros(antes), (claros(antes), claros(depois))

    page.get_by_role("button", name="Verde de teste").click()
    page.get_by_test_id("palette-delete").click()
    assert page.get_by_role("button", name="Verde de teste").count() == 0
    assert not session.errors, session.errors


def test_foto_final_no_processador(session, tmp_path):
    """A foto final sai no dobro do tamanho da vista, mostra o mesmo exame
    (mesmas regiões claras) e respeita a escultura."""
    from PIL import Image
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    caixa = view.bounding_box()
    tela = _gray_3d(page, view)

    def foto(nome):
        with page.expect_download(timeout=180000) as dl:
            page.get_by_test_id("export-3d-menu").first.click()
            page.get_by_test_id("export-3d-photo").click()
        caminho = tmp_path / nome
        dl.value.save_as(caminho)
        return Image.open(caminho).convert("L")

    imagem = foto("a.png")
    assert abs(imagem.width - 2 * caixa["width"]) <= 4
    assert abs(imagem.height - 2 * caixa["height"]) <= 4
    assert "Foto pronta" in page.get_by_test_id("photo-badge").inner_text()
    reduzida = np.asarray(imagem.resize((tela.shape[1], tela.shape[0]))).astype(float)
    # as mesmas regiões aparecem nas duas (fora os textos da tela)
    miolo = (slice(60, -60), slice(60, -60))
    a, b = tela[miolo] > 40, reduzida[miolo] > 40
    assert (a & b).sum() > 0.8 * a.sum() and (a & b).sum() > 0.8 * b.sum()

    # tirar a esfera da direita com o clique também tira da foto
    page.get_by_test_id("open-sculpt").click()
    meio = tela.shape[1] // 2
    ys, xs = np.nonzero(tela[60:-60, meio + 40:] > 120)
    page.get_by_test_id("sculpt-pick-remove").click()
    page.mouse.click(caixa["x"] + meio + 40 + float(np.median(xs)), caixa["y"] + 60 + float(np.median(ys)))
    page.wait_for_timeout(2000)
    page.get_by_test_id("sculpt-close").click()
    sem_esfera = np.asarray(foto("b.png").resize((tela.shape[1], tela.shape[0]))).astype(float)
    lado = lambda im: int((im[60:-60, meio + 40:] > 40).sum())
    assert lado(reduzida) > 200 and lado(sem_esfera) < 0.1 * lado(reduzida)
    assert not session.errors, session.errors


def test_diretor_anda_pelos_cortes_sem_esperar_e_isola_pulmoes(session):
    """Depois do primeiro corte em 3D, os vizinhos ficam prontos sozinhos:
    a roda do mouse e o controle de posição mostram o próximo na hora. E
    "só o pulmão em 3D" mostra só os pulmões."""
    page = _director(session)
    entendi = _ask_director(page, "coronal no centro em 3d")
    assert "Corte coronal no centro" in entendi
    # os vizinhos vão ficando prontos em segundo plano
    page.wait_for_function(
        """() => { const m = document.querySelector('[data-testid=director-strip]').textContent.match(/(\\d+) de (\\d+)/);
                   return m && +m[1] >= 4; }""", timeout=120000)
    antes = page.evaluate("() => document.querySelector('[data-testid=director-cut]').toDataURL()")
    corte = page.get_by_test_id("director-cut")
    corte.hover()
    inicio = page.evaluate("() => performance.now()")
    page.mouse.wheel(0, 120)
    page.wait_for_timeout(50)
    # já pronto: nada de "Desenhando", e a imagem mudou
    assert page.get_by_test_id("director-busy").inner_text().strip() == ""
    depois = page.evaluate("() => document.querySelector('[data-testid=director-cut]').toDataURL()")
    assert depois != antes
    assert page.evaluate("() => performance.now()") - inicio < 1500
    assert "5 mm para trás" in page.get_by_test_id("director-understood").inner_text()
    # andar não entra no desfazer: desfazer volta ao pedido anterior (nenhum)
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(100)
    assert "para trás" not in page.get_by_test_id("director-understood").inner_text()

    entendi = _ask_director(page, "só o pulmão em 3d")
    assert "só dos pulmões" in entendi, entendi
    cores = page.evaluate("""() => { const c = document.querySelector('[data-testid=director-cut]');
        const d = c.getContext('2d').getImageData(40, 40, c.width - 80, c.height - 120).data;
        let lit = 0, center = 0, n = 0;
        const w = c.width - 80, h = c.height - 120;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = 4 * (x + w * y); const on = d[i] + d[i+1] + d[i+2] > 60;
          if (on) lit++;
          if (Math.abs(x - w / 2) < w * 0.04 && Math.abs(y - h / 2) < h * 0.1) { n++; if (on) center++; } }
        return { lit: lit / (w * h), center: center / n }; }""")
    # aparecem os pulmões, mas o mediastino (no meio) fica vazio
    assert cores["lit"] > 0.05 and cores["center"] < 0.3, cores
    assert not session.errors, session.errors


def test_camadas_e_destaque_segurando_o_cursor(session):
    """Separar tecidos cria os botões de camada; esconder "Músculos e órgãos"
    tira o corpo e deixa as estruturas densas; esconder "Osso" tira o osso.
    "Crescer: destacar" pinta o que cresce de vermelho e deixa o resto mais
    apagado."""
    page = session.page
    session.open_files(files_of("ax_main"))
    page.wait_for_timeout(5000)
    view = page.get_by_test_id("vtk-view vtk-volume-view").first
    page.get_by_text("RENDERIZAÇÃO").first.click()
    page.get_by_text("Cores por tecido").first.click()
    page.get_by_test_id("palette-musculo").click()
    page.get_by_test_id("layer-pill").click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=layer-osso]')", timeout=60000)
    ids = f"[...{PINIA}._s.get('image-cache').imageIds][0]"
    contagem = page.evaluate(f"() => __catstudio.layers({ids}).counts")
    assert all(contagem[c] > 0 for c in ["fora", "pele", "gordura", "moles", "osso"]), contagem

    def claros():
        im = _rgb_3d(page, view)
        return int((im.sum(axis=2) > 90).sum())

    tudo = claros()
    page.get_by_test_id("layer-pele").click()
    page.get_by_test_id("layer-moles").click()
    sem_corpo = claros()
    assert sem_corpo < 0.4 * tudo, (tudo, sem_corpo)
    page.get_by_test_id("layer-osso").click()
    sem_osso = claros()
    assert 0 < sem_osso < sem_corpo, (sem_corpo, sem_osso)
    for camada in ["osso", "moles", "pele"]:
        page.get_by_test_id(f"layer-{camada}").click()
    assert claros() > 0.9 * tudo

    # crescer: destacar, segurando em cima do cilindro
    page.get_by_test_id("open-sculpt").click()
    page.get_by_test_id("sculpt-grow-highlight").click()
    caixa = view.bounding_box()
    page.mouse.move(caixa["x"] + caixa["width"] / 2, caixa["y"] + caixa["height"] * 0.3)
    page.mouse.down()
    page.wait_for_timeout(1200)
    page.mouse.up()
    page.wait_for_timeout(500)
    assert "Destacado" in _sculpt_status(page), _sculpt_status(page)
    assert page.get_by_test_id("sculpt-highlight").count() == 1
    page.get_by_test_id("sculpt-close").click()
    im = _rgb_3d(page, view)
    vermelho = int(((im[..., 0] > 180) & (im[..., 1] < 120) & (im[..., 2] < 120)).sum())
    assert vermelho > 300, vermelho
    page.get_by_test_id("open-sculpt").click()
    page.get_by_test_id("sculpt-highlight-clear").click()
    assert page.get_by_test_id("sculpt-highlight").count() == 0
    assert not session.errors, session.errors
