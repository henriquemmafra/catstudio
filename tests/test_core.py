"""Testes do núcleo: catálogo DICOM, leitura pelo Slicer, geometria, MPR e volume rendering.

Rodar (Linux/WSL headless):  xvfb-run -a pytest -q tests/test_core.py
Rodar (Windows, com placa de vídeo):  pytest -q tests\\test_core.py
"""

from __future__ import annotations

import os

import numpy as np
import pytest
from make_fixtures import phantom  # fantoma analítico usado para escrever os DICOM
from slicer import vtkMRMLViewNode
from trame_slicer.core import SlicerApp
from trame_slicer.views import DirectViewFactory, ViewLayoutDefinition
from vtkmodules.util.numpy_support import vtk_to_numpy
from vtkmodules.vtkRenderingCore import vtkWindowToImageFilter

from catstudio import dicom_index, geometry, rendering
from catstudio.loader import VolumeSampler, load_stack
from catstudio.presets import VR_PRESETS
from catstudio.views import standard_planes


def catalog(data_dir, case):
    files, skipped = dicom_index.list_files(os.path.join(data_dir, case))
    return dicom_index.build_catalog(files, pre_skipped=skipped)


def statuses(cat):
    return sorted((s.label, s.status, len(s.instances)) for s in cat.stacks())


# ------------------------------------------------------------------ catálogo
def test_nao_ordena_pelo_nome_do_arquivo(data_dir):
    # ax_implicit: nomes IMG0081.dcm … IMG0001.dcm em ordem inversa à posição; nº de instância também invertido
    s = next(catalog(data_dir, "ax_implicit").stacks())
    z = [float(i.ipp[2]) for i in s.instances]
    assert z == sorted(z)
    names = [os.path.basename(i.path) for i in s.instances]
    assert names != sorted(names)


@pytest.mark.parametrize(("case", "expected"), [
    ("ax_main", [("Volume", "ok", 81)]),
    ("cor_acq", [("Volume", "ok", 111)]),
    ("oblique", [("Volume", "ok", 101)]),
    ("tilt", [("Volume", "ok", 81)]),
    ("irregular", [("Volume", "aviso", 81)]),
    ("gap", [("Volume", "aviso", 78)]),
    ("dup", [("Volume · Aquisição 1", "ok", 81), ("Volume · Aquisição 2", "aviso", 5)]),
    ("mixed_dims", [("Parte 1 (256×256)", "ok", 60), ("Parte 2 (512×512)", "ok", 21)]),
    ("enhanced", [("Multi-frame", "erro", 1)]),
])
def test_catalogo_divide_e_julga(data_dir, case, expected):
    assert statuses(catalog(data_dir, case)) == sorted(expected)


def test_lacuna_exige_confirmacao(data_dir):
    s = next(catalog(data_dir, "gap").stacks())
    assert s.needs_confirmation
    assert len(s.geometry.missing) == 1 and abs(s.geometry.missing[0][2] - 10.0) < 1e-6


def test_tilt_medido(data_dir):
    s = next(catalog(data_dir, "tilt").stacks())
    assert abs(s.geometry.tilt_deg - 15.0) < 0.05
    assert s.geometry.collinear


def test_pasta_com_varios_estudos_e_lixo(data_dir):
    cat = catalog(data_dir, "multi")
    assert len(cat.studies) == 2
    st = statuses(cat)
    assert ("Topograma / localizador", "erro", 1) in st
    assert sum(1 for x in st if x[1] == "ok") == 3
    assert cat.skipped["nao_dicom"] >= 1 and cat.skipped["sem_imagem"] >= 1
    # sem dado de paciente em lugar nenhum do catálogo
    text = repr(cat.studies)
    assert "NAO" not in text.upper().replace("NÃO", "")


def test_copia_exata_descartada(data_dir):
    assert catalog(data_dir, "dup").skipped["repetido"] == 1


# ------------------------------------------------------------------ leitura pelo Slicer
def _load(data_dir, case, pick=None):
    app = SlicerApp()
    cat = catalog(data_dir, case)
    stacks = [s for s in cat.stacks() if s.status != "erro"]
    s = pick(stacks) if pick else max(stacks, key=lambda x: len(x.instances))
    return app, s, load_stack(app, s)


def _voxel_error(res, n=8000):
    node = res.volume_node
    img = node.GetImageData()
    dims = img.GetDimensions()
    a = vtk_to_numpy(img.GetPointData().GetScalars()).reshape(dims[2], dims[1], dims[0]).astype(float)
    rng = np.random.default_rng(1)
    ijk = np.stack([rng.integers(0, dims[0], n), rng.integers(0, dims[1], n), rng.integers(0, dims[2], n),
                    np.ones(n)])
    ras = (res.ijk_to_ras @ ijk)[:3]
    ref = phantom(-ras[0], -ras[1], ras[2])
    val = a[ijk[2].astype(int), ijk[1].astype(int), ijk[0].astype(int)]
    keep = val > -2000          # fora do FOV (preenchimento −3024) não conta
    err = np.abs(val - ref)[keep]
    return float(err.mean()), float((err > 100).mean())


@pytest.mark.parametrize("case", ["ax_main", "ax_implicit", "cor_acq", "oblique", "tilt", "irregular", "gap",
                                  "multi", "mixed_dims"])
def test_volume_do_slicer_bate_com_o_fantoma(data_dir, case):
    _, s, res = _load(data_dir, case)
    mean, frac = _voxel_error(res)
    assert mean < 2.0, (case, mean)
    assert frac < 0.002, (case, frac)
    # conferência independente: matriz IJK→RAS do Slicer × posições dos cabeçalhos
    assert res.check_mm is not None and res.check_mm < 0.05, res.check_mm


def test_espacamento_anisotropico_preservado(data_dir):
    _, _, res = _load(data_dir, "ax_main")
    assert res.dims == (320, 300, 81)
    assert np.allclose(res.spacing, (1.0, 0.8, 2.5))


def test_lps_para_ras(data_dir):
    """O marcador à ESQUERDA do paciente (LPS x=+90) tem que cair em RAS x=−90."""
    _, _, res = _load(data_dir, "ax_main")
    smp = VolumeSampler(res.volume_node)
    assert smp((-90.0, 20.0, 40.0)) > 900          # centro do marcador (1000 HU)
    assert smp((90.0, 20.0, 40.0)) < -500          # espelho: pulmão direito


def test_codecs_identicos_a_referencia(data_dir):
    def arr(case):
        _, _, res = _load(data_dir, os.path.join("codecs", case))
        img = res.volume_node.GetImageData()
        return vtk_to_numpy(img.GetPointData().GetScalars()).astype(np.int32), res.ijk_to_ras

    ref, mref = arr("ref")
    for case in ["j2k", "j2k_unsigned", "jls", "rle", "jpegll", "deflate", "bigendian"]:
        a, m = arr(case)
        assert np.array_equal(a, ref), case
        assert np.allclose(m, mref), case


# ------------------------------------------------------------------ MPR (vistas 2D do Slicer, fora de tela)
def _views(app):
    app.view_manager.register_factory(DirectViewFactory(do_render_offscreen=True))
    views = {}
    for d in (ViewLayoutDefinition.axial_view(), ViewLayoutDefinition.coronal_view(),
              ViewLayoutDefinition.sagittal_view()):
        views[d.properties.orientation] = app.view_manager.create_view(d)
    return views


SIZE = 240


def _grab(view, size=SIZE):
    view.render()
    w2i = vtkWindowToImageFilter()
    w2i.SetInput(view.render_window())
    w2i.ReadFrontBufferOff()
    w2i.SetInputBufferTypeToRGB()
    w2i.Update()
    img = w2i.GetOutput()
    nx, ny, _ = img.GetDimensions()
    a = vtk_to_numpy(img.GetPointData().GetScalars()).reshape(ny, nx, 3)[::-1]
    return a.mean(axis=2)


def _mpr_images(data_dir, case, center_ras, fov=110.0, size=SIZE):
    """Renderiza as três vistas do Slicer (planos anatômicos do CatStudio) centradas em `center_ras`."""
    app, _, res = _load(data_dir, case)
    views = _views(app)
    app.display_manager.show_volume(res.volume_node, do_reset_views=True)
    standard_planes(views.values())
    dn = res.volume_node.GetDisplayNode()
    dn.AutoWindowLevelOff()
    dn.SetWindowLevel(2400, -200)   # ar dentro do volume ≠ preto; fora do volume = 0
    out = {}
    for name, v in views.items():
        v.render_window().SetSize(size, size)
        sn = v.get_view_node()
        sn.SetDimensions(size, size, 1)
        sn.SetFieldOfView(fov, fov, sn.GetFieldOfView()[2])
        sn.SetXYZOrigin(0, 0, 0)
        sn.JumpSliceByCentering(*center_ras)
        sn.UpdateMatrices()
        out[name] = _grab(v, size)
    return out


MARKER_L_RAS = (-90.0, 20.0, 40.0)


def test_mpr_concorda_entre_aquisicoes():
    """O mesmo ponto anatômico, visto em axial/coronal/sagital, tem que gerar as mesmas imagens
    a partir de uma aquisição axial (pixel não quadrado), coronal, oblíqua e com gantry tilt."""
    data_dir = os.path.join(os.path.dirname(__file__), ".data")
    ref = _mpr_images(data_dir, "ax_main", MARKER_L_RAS)
    for case in ["cor_acq", "oblique", "tilt"]:
        imgs = _mpr_images(data_dir, case, MARKER_L_RAS)
        for plane in ("Axial", "Coronal", "Sagittal"):
            both = (imgs[plane] > 2) & (ref[plane] > 2)      # só onde os dois volumes têm dados
            d = np.abs(imgs[plane] - ref[plane])[both]
            assert both.mean() > 0.9, (case, plane, both.mean())
            assert d.mean() < 1.5 and np.percentile(d, 99) < 20, (case, plane, d.mean())


def test_mpr_marcador_no_centro_e_proporcoes():
    data_dir = os.path.join(os.path.dirname(__file__), ".data")
    imgs = _mpr_images(data_dir, "ax_main", MARKER_L_RAS)
    for plane, img in imgs.items():
        ys, xs = np.nonzero(img > 225)          # só o marcador de 1000 HU passa de 225 em W2400/L−200
        assert abs(xs.mean() - img.shape[1] / 2) < 3 and abs(ys.mean() - img.shape[0] / 2) < 3, plane
    # elipsoide E: semi-eixos 25 (D–E) × 12 (A–P) × 35 mm (S–I) — medidas em cada plano
    e_ras = (80.0, 10.0, -50.0)
    imgs = _mpr_images(data_dir, "ax_main", e_ras, fov=110.0)
    mm_px = 110.0 / SIZE
    c = SIZE // 2
    for plane, (w_exp, h_exp) in {"Axial": (50, 24), "Coronal": (50, 70), "Sagittal": (24, 70)}.items():
        img = imgs[plane]
        inside = img > 105          # meio do caminho entre o elipsoide (200 HU ≈ 149) e o pulmão (−850 ≈ 58)
        assert inside[c, c], plane

        def run(line, k):
            a = b = k
            while a > 0 and line[a - 1]:
                a -= 1
            while b < len(line) - 1 and line[b + 1]:
                b += 1
            return (b - a + 1) * mm_px

        w, h = run(inside[c, :], c), run(inside[:, c], c)
        assert abs(w - w_exp) < 2 and abs(h - h_exp) < 2, (plane, w, h)


def test_orientacao_radiologica_axial():
    """Axial em convenção radiológica: direita do paciente à esquerda da tela."""
    data_dir = os.path.join(os.path.dirname(__file__), ".data")
    imgs = _mpr_images(data_dir, "ax_main", (0.0, 0.0, 40.0), fov=330.0)
    img = imgs["Axial"]
    ys, xs = np.nonzero(img > 225)        # só o marcador L (1000 HU) passa de 225 nesse corte
    assert xs.mean() > img.shape[1] / 2   # paciente esquerdo → lado direito da tela


# ------------------------------------------------------------------ volume rendering
def _render_3d(data_dir, case, preset="Osso", opacity=100.0, palette="Original do Slicer", size=260, roi=None):
    app, _, res = _load(data_dir, case)
    app.view_manager.register_factory(DirectViewFactory(do_render_offscreen=True))
    view = app.view_manager.create_view(ViewLayoutDefinition.threed_view())
    app.display_manager.show_volume(res.volume_node, do_reset_views=True)
    if roi is not None:      # recorte nativo do Slicer (ROI) numa região coberta por todas as aquisições
        node = app.scene.AddNewNodeByClass("vtkMRMLMarkupsROINode")
        node.SetCenter(*roi[0])
        node.SetSize(*roi[1])
        node.SetDisplayVisibility(False)
        app.volume_rendering.set_cropping_enabled(res.volume_node, node, True)
    rendering.apply_style(app.volume_rendering, res.volume_node,
                          rendering.VolumeStyle(preset=preset, opacity=opacity, palette=palette), [view])
    view.set_background_color([0, 0, 0])
    cam = view.get_camera_node().GetCamera()
    cam.SetFocalPoint(0, 0, 0)
    cam.SetPosition(0, 800, 0)       # observando de anterior (+A)
    cam.SetViewUp(0, 0, 1)
    cam.ParallelProjectionOn()
    cam.SetParallelScale(170)
    view.renderer().ResetCameraClippingRange()
    view.render_window().SetSize(size, size)
    view.render()
    w2i = vtkWindowToImageFilter()
    w2i.SetInput(view.render_window())
    w2i.ReadFrontBufferOff()
    w2i.SetInputBufferTypeToRGB()
    w2i.Update()
    img = w2i.GetOutput()
    nx, ny, _ = img.GetDimensions()
    return vtk_to_numpy(img.GetPointData().GetScalars()).reshape(ny, nx, 3)[::-1].astype(float), app, res, view


def test_volume_rendering_produz_imagem_real():
    data_dir = os.path.join(os.path.dirname(__file__), ".data")
    img, *_ = _render_3d(data_dir, "ax_main")
    assert img.std() > 10 and img.max() > 100      # não é tela vazia
    transparent, *_ = _render_3d(data_dir, "ax_main", opacity=0)
    assert transparent.max() < 5                   # opacidade 0% = só o fundo preto


def _dense_mask(view, app, res):
    """Máscara das estruturas densas (coluna, marcadores, cubo) vistas no 3D: preset Osso deslocado +350 HU."""
    rendering.apply_style(app.volume_rendering, res.volume_node, rendering.VolumeStyle(preset="Osso", shift=350),
                          [view])
    view.render()
    w2i = vtkWindowToImageFilter()
    w2i.SetInput(view.render_window())
    w2i.ReadFrontBufferOff()
    w2i.SetInputBufferTypeToRGB()
    w2i.Update()
    im = w2i.GetOutput()
    nx, ny, _ = im.GetDimensions()
    img = vtk_to_numpy(im.GetPointData().GetScalars()).reshape(ny, nx, 3)[::-1]
    return img.max(axis=2) > 40


def _iou(a, b):
    return float((a & b).sum() / max(1, (a | b).sum()))


def test_volume_rendering_concorda_entre_aquisicoes():
    """Mesma câmera e mesmo recorte: as estruturas densas reconstruídas em 3D a partir de aquisições
    diferentes do mesmo corpo têm que coincidir — inclusive com a matriz cisalhada do gantry tilt.
    Controle: o mesmo volume deslocado 10 mm precisa reprovar no mesmo critério."""
    data_dir = os.path.join(os.path.dirname(__file__), ".data")
    roi = ((0.0, 0.0, 0.0), (240.0, 160.0, 120.0))
    _, app, res, view = _render_3d(data_dir, "ax_main", roi=roi)
    ref = _dense_mask(view, app, res)
    assert ref.sum() > 1000
    for case in ["cor_acq", "tilt", "oblique"]:
        _, app2, res2, view2 = _render_3d(data_dir, case, roi=roi)
        iou = _iou(_dense_mask(view2, app2, res2), ref)
        assert iou > 0.9, (case, iou)
    o = list(res.volume_node.GetOrigin())
    res.volume_node.SetOrigin(o[0] + 10, o[1], o[2])
    shifted = _iou(_dense_mask(view, app, res), ref)
    assert shifted < 0.8, shifted


def test_presets_mip_e_paleta():
    data_dir = os.path.join(os.path.dirname(__file__), ".data")
    _, app, res, view = _render_3d(data_dir, "ax_main", preset="MIP (projeção de intensidade máxima)")
    assert view.get_view_node().GetRaycastTechnique() == vtkMRMLViewNode.MaximumIntensityProjection
    rendering.apply_style(app.volume_rendering, res.volume_node, rendering.VolumeStyle(preset="Osso"), [view])
    assert view.get_view_node().GetRaycastTechnique() == vtkMRMLViewNode.Composite
    warm, *_ = _render_3d(data_dir, "ax_main", palette="Cinematográfico quente")
    cold, *_ = _render_3d(data_dir, "ax_main", palette="Frio")
    # paleta quente puxa para o vermelho, fria para o azul
    assert warm[..., 0].mean() > warm[..., 2].mean()
    assert cold[..., 2].mean() > cold[..., 0].mean()


def test_todos_os_presets_existem_no_slicer():
    app = SlicerApp()
    names = set(app.volume_rendering.preset_names())
    assert set(VR_PRESETS.values()) <= names


def test_deslocamento_absoluto_nao_acumula():
    app = SlicerApp()
    st = rendering.VolumeStyle(preset="Osso", shift=100)
    c1, o1 = rendering.styled_functions(app.volume_rendering, st)
    c2, o2 = rendering.styled_functions(app.volume_rendering, st)
    assert c1 == c2 and o1 == o2
    base_c, base_o = rendering.styled_functions(app.volume_rendering, rendering.VolumeStyle(preset="Osso"))
    assert all(abs(a[0] - b[0] - 100) < 1e-9 for a, b in zip(o1, base_o))


def test_formatacao():
    assert geometry.fmt_mm(320.0, 0) == "320"
    assert geometry.fmt_mm(2.50, 2) == "2,5"
    assert geometry.fmt_mm(-0.0001, 1) == "0"
