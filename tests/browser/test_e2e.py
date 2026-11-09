"""Testes ponta a ponta no navegador: servidor CatStudio real (núcleo do Slicer) + Chrome headless.

Rodar:  CATSTUDIO_PYTHON=<python do venv> xvfb-run -a pytest -q tests/browser
(o Playwright pode estar em outro Python; o servidor roda no Python indicado em CATSTUDIO_PYTHON)
"""

from __future__ import annotations

import io
import os
import re
import sys

import numpy as np
import pytest
from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "fixtures"))
from harness import CHROME, DATA, OUT, server, state, wait_state  # noqa: E402
from make_fixtures import phantom  # noqa: E402

VIEW = {"width": 1680, "height": 1000}


@pytest.fixture(scope="module")
def pw():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch()
        yield b
        b.close()


def open_app(pw, url):
    ctx = pw.new_context(viewport=VIEW, accept_downloads=True)
    page = ctx.new_page()
    page.requests = []
    page.on("request", lambda r: page.requests.append(r.url))
    page.goto(url, wait_until="networkidle")
    wait_state(page, "s.get('cs_status') !== undefined")
    page.wait_for_timeout(1500)
    return page


def quadrant(page, name):
    """Recorte (numpy RGB) da vista indicada: axial/coronal/sagital/3d, pela posição na tela."""
    img = np.array(Image.open(io.BytesIO(page.screenshot())).convert("RGB")).astype(float)
    boxes = page.evaluate("""() => [...document.querySelectorAll('.layout-grid-item')].map(e => {
        const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })""")
    boxes.sort(key=lambda b: (round(b[1] / 50), b[0]))   # cima-esquerda, cima-direita, baixo-esq., baixo-dir.
    order = {"axial": 0, "coronal": 1, "sagital": 2, "3d": 3}
    x, y, w, h = (int(v) for v in boxes[order[name]])
    return img[y + 30: y + h - 40, x + 40: x + w - 10]


def upload(page, selector, path):
    page.set_input_files(selector, path)


def test_pasta_dicom_quatro_vistas_e_privacidade(pw):
    with server() as url:
        page = open_app(pw, url)
        page.screenshot(path=f"{OUT}/e2e_00_inicio.png")
        upload(page, "#cs-folder", os.path.join(DATA, "ax_main"))
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        page.wait_for_timeout(3000)
        page.screenshot(path=f"{OUT}/e2e_01_carregado.png")
        info = state(page, "cs_info")
        assert info["dims"] == "320 × 300 × 81"
        assert info["spacing"] == "1 × 0,8 × 2,5 mm"
        assert info["check"].startswith("conferida")
        # letras de orientação radiológica
        assert state(page, "cs_ov_Red") | {"pos": ""} == {"l": "R", "r": "L", "t": "A", "b": "P", "pos": ""}
        assert state(page, "cs_ov_Green")["t"] == "S" and state(page, "cs_ov_Green")["l"] == "R"
        assert state(page, "cs_ov_Yellow")["l"] == "A" and state(page, "cs_ov_Yellow")["r"] == "P"
        # as quatro vistas têm imagem (não são retângulos vazios)
        for q in ("axial", "coronal", "sagital", "3d"):
            assert quadrant(page, q).std() > 8, q
        # privacidade: nome/ID falsos gravados nos DICOM nunca aparecem; nada sai para a internet
        text = page.evaluate("() => document.body.innerText + JSON.stringify(window.trame.state.state)")
        assert "NAO EXIBIR" not in text.upper() and "NAO-EXIBIR" not in text.upper() and "NAO^EXIBIR" not in text
        external = [u for u in page.requests if not re.match(r"^(https?|wss?)://127\.0\.0\.1[:/]", u)
                    and not u.startswith(("data:", "blob:"))]
        assert external == [], external


def test_zip_com_varias_series_estudos_e_lixo(pw):
    with server() as url:
        page = open_app(pw, url)
        upload(page, "#cs-files", os.path.join(DATA, "multi.zip"))
        wait_state(page, "s.get('cs_studies').length === 2", 120000)
        assert state(page, "cs_loaded") is False                     # 3 séries válidas: o usuário escolhe
        skipped = state(page, "cs_skipped")
        assert "não é DICOM" in skipped and "sem imagem" in skipped
        page.screenshot(path=f"{OUT}/e2e_02_series.png")
        # localizador: clicar explica por que não carrega
        page.locator(".cs-stack", has_text="Topograma").click()
        wait_state(page, "s.get('cs_error').includes('localizador')")
        # escolher a série de 5 mm
        page.locator(".cs-stack", has_text="41 img").first.click()
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        assert state(page, "cs_info")["dims"] == "256 × 256 × 41"


def test_lacuna_pede_confirmacao(pw):
    with server() as url:
        page = open_app(pw, url)
        upload(page, "#cs-folder", os.path.join(DATA, "gap"))
        wait_state(page, "s.get('cs_studies').length === 1", 120000)
        page.locator(".cs-stack").first.click()
        wait_state(page, "s.get('cs_confirm_open') === true")
        page.screenshot(path=f"{OUT}/e2e_03_confirmacao.png")
        assert state(page, "cs_loaded") is False
        page.get_by_text("Carregar mesmo assim").click()
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        assert "lacuna" in state(page, "cs_notice")


def test_multiframe_e_explicado(pw):
    with server() as url:
        page = open_app(pw, url)
        upload(page, "#cs-folder", os.path.join(DATA, "enhanced"))
        wait_state(page, "s.get('cs_studies').length === 1", 120000)
        page.locator(".cs-stack").first.click()
        wait_state(page, "s.get('cs_error').includes('multi-frame')")
        assert state(page, "cs_loaded") is False


def test_janela_controles_3d_camera_e_captura(pw):
    with server() as url:
        page = open_app(pw, url)
        upload(page, "#cs-folder", os.path.join(DATA, "ax_main"))
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        page.wait_for_timeout(2500)

        ax0 = quadrant(page, "axial")
        page.get_by_role("button", name="Osso", exact=True).click()
        wait_state(page, "s.get('cs_ww') === 1800 && s.get('cs_wl') === 400")
        page.wait_for_timeout(1500)
        ax1 = quadrant(page, "axial")
        assert np.abs(ax1 - ax0).mean() > 10           # janela de osso escurece o pulmão/partes moles

        v0 = quadrant(page, "3d")
        page.evaluate("() => window.trame.state.set('cs_vr_preset', 'Pulmão')")
        page.wait_for_timeout(2500)
        v1 = quadrant(page, "3d")
        assert np.abs(v1 - v0).mean() > 3, "preset 3D não mudou a imagem"

        page.evaluate("() => window.trame.state.set('cs_vr_opacity', 0)")
        page.wait_for_timeout(2500)
        v2 = quadrant(page, "3d")
        page.evaluate("() => window.trame.state.set('cs_vr_opacity', 100)")
        page.wait_for_timeout(2000)
        v3 = quadrant(page, "3d")
        assert v2.std() < v3.std()                       # sem opacidade sobra só o fundo

        page.evaluate("() => window.trame.state.set('cs_vr_palette', 'Frio')")
        page.wait_for_timeout(2500)
        v4 = quadrant(page, "3d")
        assert np.abs(v4 - v3).mean() > 2

        page.get_by_role("button", name="S", exact=True).click()        # vista superior
        page.wait_for_timeout(2500)
        v5 = quadrant(page, "3d")
        assert np.abs(v5 - v4).mean() > 3, "botão de câmera não girou a vista"
        page.screenshot(path=f"{OUT}/e2e_04_controles.png")

        page.evaluate("() => window.trame.state.set('cs_spin', true)")
        page.wait_for_timeout(1500)
        s1 = quadrant(page, "3d")
        page.wait_for_timeout(1500)
        s2 = quadrant(page, "3d")
        page.evaluate("() => window.trame.state.set('cs_spin', false)")
        assert np.abs(s2 - s1).mean() > 1, "rotação contínua não girou"

        a0 = quadrant(page, "axial")
        page.evaluate("() => { window.trame.state.set('cs_slab', 'MIP'); window.trame.state.set('cs_slab_mm', 90); }")
        page.wait_for_timeout(2000)
        assert np.abs(quadrant(page, "axial") - a0).mean() > 2, "slab MIP não mudou o axial"
        page.evaluate("() => window.trame.state.set('cs_slab', 'Desligado')")
        t0 = quadrant(page, "3d")
        page.evaluate("() => window.trame.state.set('cs_planes_3d', true)")
        page.wait_for_timeout(2000)
        assert np.abs(quadrant(page, "3d") - t0).mean() > 1, "planos MPR não apareceram no 3D"
        assert state(page, "cs_error") == ""

        with page.expect_download() as dl:
            page.get_by_text("Salvar imagem 3D (PNG)").click()
        path = dl.value.path()
        png = Image.open(path)
        assert png.format == "PNG" and png.size[0] > 200 and np.array(png).std() > 5


def test_sonda_mostra_hu_coerente_com_a_anatomia(pw):
    """Passa o mouse em vários pontos do axial; a coordenada e o HU que o CatStudio mostra têm que
    bater com o fantoma naquele ponto (a sonda lê o volume do Slicer pela posição do cursor do Slicer)."""
    with server() as url:
        page = open_app(pw, url)
        upload(page, "#cs-folder", os.path.join(DATA, "ax_main"))
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        page.wait_for_timeout(2000)
        boxes = page.evaluate("""() => [...document.querySelectorAll('.layout-grid-item')].map(e => {
            const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })""")
        boxes.sort(key=lambda b: (round(b[1] / 50), b[0]))
        x, y, w, h = boxes[0]
        checked = 0
        for fx, fy in [(0.5, 0.5), (0.3, 0.45), (0.7, 0.55), (0.5, 0.75), (0.62, 0.35)]:
            page.mouse.move(x + w * fx, y + h * fy)
            page.wait_for_timeout(500)
            page.mouse.move(x + w * fx + 1, y + h * fy)
            page.wait_for_timeout(700)
            probe = state(page, "cs_probe")
            m = re.match(r"([RL]) ([\d,]+) · ([AP]) ([\d,]+) · ([SI]) ([\d,]+) mm\s+·\s+(-?\d+) HU", probe)
            if not m:
                continue
            sgn = {"R": 1, "L": -1, "A": 1, "P": -1, "S": 1, "I": -1}
            ras = [sgn[m.group(i)] * float(m.group(i + 1).replace(",", ".")) for i in (1, 3, 5)]
            hu = float(m.group(7))
            expected = float(phantom(np.array(-ras[0]), np.array(-ras[1]), np.array(ras[2])))
            assert abs(hu - expected) < 60, (probe, expected)
            checked += 1
        assert checked >= 3


def test_mouse_rolagem_e_janela_nas_vistas_2d(pw):
    """Gestos nativos do Slicer passando pelo navegador: roda = troca de corte; arrastar = janela."""
    with server() as url:
        page = open_app(pw, url)
        upload(page, "#cs-folder", os.path.join(DATA, "ax_main"))
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        page.wait_for_timeout(2000)
        boxes = page.evaluate("""() => [...document.querySelectorAll('.layout-grid-item')].map(e => {
            const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })""")
        boxes.sort(key=lambda b: (round(b[1] / 50), b[0]))
        x, y, w, h = boxes[0]
        cx, cy = x + w * 0.5, y + h * 0.45
        pos0 = state(page, "cs_ov_Red")["pos"]
        page.mouse.move(cx, cy)
        for _ in range(4):
            page.mouse.wheel(0, 120)
            page.wait_for_timeout(250)
        page.wait_for_timeout(1000)
        assert state(page, "cs_ov_Red")["pos"] != pos0, "a roda não trocou o corte axial"
        ww0, wl0 = state(page, "cs_ww"), state(page, "cs_wl")
        page.mouse.move(cx, cy)
        page.mouse.down()
        for k in range(12):
            page.mouse.move(cx + 8 * k, cy + 5 * k)
            page.wait_for_timeout(60)
        page.mouse.up()
        page.wait_for_timeout(1200)
        assert (state(page, "cs_ww"), state(page, "cs_wl")) != (ww0, wl0), "arrastar não ajustou a janela"


def test_pasta_local_ao_iniciar(pw):
    with server("--open", os.path.join(DATA, "tilt")) as url:
        page = open_app(pw, url)
        wait_state(page, "s.get('cs_loaded') === true", 120000)
        info = state(page, "cs_info")
        assert "gantry 15°" in info["plane"]
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/e2e_05_tilt.png")
