"""Ostium dentro do CatStudio — escore de cálcio medido na série aberta.

Abre o fantoma de make_calcio.py pelo CatStudio, entra no Ostium, atribui os
três focos por clique e confere o Agatston contra o valor analítico; depois
testa o laço (corta parte de um foco), o desfazer e o texto do laudo.
"""
import os

import pytest

from make_calcio import ESPERADO, FOCOS, OUT
from make_fixtures import FAKE_ID, FAKE_NAME
from test_navegador import browser, session, url  # noqa: F401  (fixtures)

TECLA = {"TCE": "1", "DA": "2", "CX": "3", "CD": "4"}


def _corte(page, z):
    page.evaluate("z => { const s = document.querySelector('.ostium #slider'); s.value = z;"
                  " s.dispatchEvent(new Event('input')); }", z)


def _ponto(page, col, lin):
    r = page.locator(".ostium .cacimg").bounding_box()
    return r["x"] + col / 512 * r["width"], r["y"] + lin / 512 * r["height"]


def _escore(page):
    return {v: int(page.input_value(f".ostium #cac-{v}")) for v in TECLA}


@pytest.mark.skipif(not os.path.isdir(OUT), reason="rode make_calcio.py para gerar o fantoma do escore")
def test_escore_de_calcio_na_serie_aberta(session):
    page = session.page
    session.open_folder(OUT)
    page.get_by_test_id("open-ostium").click()
    page.locator(".ostium #report .line").first.wait_for(timeout=60000)
    page.locator(".ostium #reset").click()
    page.locator(".ostium .colhead .useseries").click()
    page.locator(".ostium .cacimg").wait_for(timeout=60000)
    page.wait_for_timeout(500)

    # idade e sexo vêm do DICOM; a série e a técnica são reconhecidas sem aviso
    assert page.input_value(".ostium #age") == "63"
    assert page.inner_text(".ostium #cacmsg").startswith("3 focos candidatos")

    # clique = foco inteiro, em todos os cortes
    for vaso, (z, col, lin) in FOCOS.items():
        _corte(page, z)
        page.keyboard.press(TECLA[vaso])
        page.mouse.click(*_ponto(page, col + 0.5, lin + 0.5))
        page.wait_for_timeout(200)
    assert _escore(page) == ESPERADO

    laudo = page.inner_text(".ostium #report")
    assert "O escore de cálcio total é 46 (Classificação A1 - calcificação coronária baixa)" in laudo
    assert "TCE: 0\nDA: 38\nCX: 5\nCD: 3\nTotal: 46" in laudo.replace("\n\n", "\n")

    # osso não é candidato: clicar na coluna não muda nada
    _corte(page, 20)
    page.mouse.click(*_ponto(page, 256.5, 360.5))
    page.wait_for_timeout(200)
    assert "Estrutura grande" in page.inner_text(".ostium #cacmsg")
    assert _escore(page) == ESPERADO

    # laço: exclui as colunas 253–255 do foco A no corte 20 -> 15 px × 0,16 × 4 + 19,2 = 28,8
    page.keyboard.press("0")
    pontos = [(253, 228), (258, 228), (258, 237), (253, 237), (253, 228)]
    page.mouse.move(*_ponto(page, *pontos[0]))
    page.mouse.down()
    for p in pontos[1:]:
        page.mouse.move(*_ponto(page, *p), steps=4)
    page.mouse.up()
    page.wait_for_timeout(200)
    assert _escore(page)["DA"] == 29
    page.keyboard.press("Control+z")
    page.wait_for_timeout(200)
    assert _escore(page) == ESPERADO

    # identificação do paciente não aparece no Ostium; voltar às imagens fecha a área
    corpo = page.inner_text("body").upper()
    assert FAKE_ID not in corpo and FAKE_NAME.upper() not in corpo and "1963" not in corpo
    page.locator(".ostium #closeostium").click()
    page.wait_for_timeout(300)
    assert not page.locator(".ostium").is_visible()
    assert not session.errors, session.errors
