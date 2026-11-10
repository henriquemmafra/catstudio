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
    def __init__(self, browser, url):
        self.url = url
        self.page = browser.new_page(viewport={"width": 1600, "height": 950}, accept_downloads=True)
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
        page.get_by_test_id("export-3d-png").first.click()
    d = dl.value
    assert d.suggested_filename.startswith("catstudio-3d-") and d.suggested_filename.endswith(".png")
    path = tmp_path / d.suggested_filename
    d.save_as(path)
    std, shape = _image_std(path.read_bytes())
    assert std > 5 and shape[0] > 100 and shape[1] > 100
    assert not session.errors, session.errors


# ------------------------------------------------------------------ memória

BIG = os.path.join(DATA, "exame_grande")


@pytest.mark.skipif(not os.path.isdir(BIG), reason="rode make_exame_grande.py para gerar o exame completo")
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

    with page.expect_file_chooser() as fc:
        page.get_by_test_id("welcome-open-folder").click()
    fc.value.set_files(BIG)
    t0 = time.time()
    while not session.state() and time.time() - t0 < 120:
        sample()
        page.wait_for_timeout(500)
    session.wait_loaded(timeout=400)
    st = session.state()
    assert len(st) == 7
    assert sum(x["st"] == "complete" for x in st) == 1, st
    assert max(heap) < 400, f"heap JS chegou a {max(heap):.0f} MB na importação"
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
