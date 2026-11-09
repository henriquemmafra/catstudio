"""CatStudio — aplicação web sobre o núcleo do 3D Slicer (slicer-core) via trame-slicer.

Servidor Python: cena MRML, lógicas, leitor DICOM e renderização do próprio Slicer.
Navegador: interface (Vue/Vuetify via trame) e imagens das vistas transmitidas pelo servidor.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

import numpy as np
from slicer import vtkMRMLAbstractViewNode, vtkMRMLApplicationLogic, vtkMRMLCameraNode, vtkMRMLCrosshairNode, \
    vtkMRMLInteractionNode, vtkMRMLViewNode
from trame.app import TrameApp
from trame.ui.vuetify3 import VAppLayout
from trame.widgets import client, html
from trame.widgets import vuetify3 as v3
from trame_slicer import module as trame_slicer_module
from trame_slicer.app.ui import create_vertical_slice_view_gutter_ui, create_vertical_view_gutter_ui
from trame_slicer.core import LayoutManager, SlicerApp
from trame_slicer.rca_view import register_rca_factories
from trame_slicer.views import Layout, LayoutDirection, ViewLayoutDefinition
from trame_slicer.views.threed_view import ViewDirection
from vtkmodules.vtkCommonCore import VTK_IMAGE_SLAB_MAX, VTK_IMAGE_SLAB_MEAN, VTK_IMAGE_SLAB_MIN, vtkCommand
from vtkmodules.vtkIOImage import vtkPNGWriter
from vtkmodules.vtkRenderingCore import vtkWindowToImageFilter

from . import __version__, dicom_index, geometry, rendering
from .ingest import Session
from .loader import VolumeSampler, load_stack
from .views import standard_planes
from .presets import BACKGROUNDS, DEFAULT_VR, PALETTES, SLICE_VIEWS, VR_PRESETS, WINDOW_PRESETS

log = logging.getLogger("catstudio")

LAYOUTS = {
    "Quatro quadrantes": lambda a, c, s, t: Layout(LayoutDirection.Horizontal, [
        Layout(LayoutDirection.Vertical, [a, s]), Layout(LayoutDirection.Vertical, [c, t])]),
    "3D em destaque": lambda a, c, s, t: Layout(LayoutDirection.Horizontal, [
        t, Layout(LayoutDirection.Vertical, [a, c, s])], flex_sizes=["2", "1"]),
    "Somente 3D": lambda a, c, s, t: Layout(LayoutDirection.Vertical, [t]),
    "Somente axial": lambda a, c, s, t: Layout(LayoutDirection.Vertical, [a]),
}
SLAB = {"Desligado": None, "MIP": "max", "MinIP": "min", "Média": "mean"}
QUALITY = {"Interativa": vtkMRMLViewNode.Adaptive, "Normal": vtkMRMLViewNode.Normal,
           "Máxima": vtkMRMLViewNode.Maximum}
CAMERA_VIEWS = [("A", "Anterior", ViewDirection.ANTERIOR), ("P", "Posterior", ViewDirection.POSTERIOR),
                ("D", "Direita do paciente", ViewDirection.RIGHT), ("E", "Esquerda do paciente", ViewDirection.LEFT),
                ("S", "Superior", ViewDirection.SUPERIOR), ("I", "Inferior", ViewDirection.INFERIOR)]

CSS = """
:root { --cs-bg:#07090c; --cs-panel:#0d1117; --cs-line:#1e2630; --cs-text:#dbe3ea; --cs-muted:#8a97a4;
        --cs-accent:#5ec8d8; --cs-warn:#e9b44c; --cs-err:#ef6b73; --cs-ok:#58c48b; }
html, body { overflow: hidden !important; background: var(--cs-bg); }
.v-application { background: var(--cs-bg) !important; color: var(--cs-text); font-feature-settings: "tnum"; }
.cs-bar { background: linear-gradient(180deg,#0e141b,#0a0e13) !important; border-bottom: 1px solid var(--cs-line); }
.cs-brand { font-weight: 800; letter-spacing: -.03em; font-size: 19px; }
.cs-brand span { color: var(--cs-accent); }
.cs-sub { color: var(--cs-muted); font-size: 11px; line-height: 1.1; }
.cs-drawer { background: var(--cs-panel) !important; border-color: var(--cs-line) !important; }
.cs-h { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--cs-muted);
        margin: 14px 0 6px; font-weight: 700; }
.cs-kv { display: grid; grid-template-columns: 112px 1fr; gap: 2px 8px; font-size: 12px; }
.cs-kv b { color: var(--cs-muted); font-weight: 500; }
.cs-msg { font-size: 11.5px; line-height: 1.35; color: #c9d3dc; margin: 3px 0 0; }
.cs-msg.aviso { color: var(--cs-warn); } .cs-msg.erro { color: var(--cs-err); }
.cs-stack { border: 1px solid var(--cs-line); border-radius: 8px; padding: 7px 9px; margin: 6px 0; cursor: pointer;
            transition: border-color .15s, background .15s; }
.cs-stack:hover { border-color: #3b4a58; background: #111821; }
.cs-stack.active { border-color: var(--cs-accent); background: #0f1d24; }
.cs-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
.cs-dot.ok { background: var(--cs-ok); } .cs-dot.aviso { background: var(--cs-warn); } .cs-dot.erro { background: var(--cs-err); }
.cs-ov { position:absolute; pointer-events:none; color:#e8eef3; font: 600 13px/1 system-ui, sans-serif;
         text-shadow: 0 0 3px #000, 0 0 2px #000; z-index: 3; }
.cs-ov.l { left: 6px; top: 50%; } .cs-ov.r { right: 8px; top: 50%; }
.cs-ov.t { top: 6px; left: 50%; } .cs-ov.b { bottom: 30px; left: 50%; }
.cs-ov.name { top: 8px; right: 10px; font-size: 11px; letter-spacing: .08em; }
.cs-ov.pos { bottom: 30px; right: 10px; font-size: 12px; font-weight: 500; }
.cs-ov.three { top: 8px; right: 10px; font-size: 11px; letter-spacing: .08em; color: var(--cs-accent); }
.cs-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center;
            color: var(--cs-muted); font-size: 13px; pointer-events:none; z-index: 2; padding: 20px; }
.cs-foot { font-size: 11.5px; color: var(--cs-muted); background: #0a0e13 !important; border-top: 1px solid var(--cs-line); }
.cs-probe { color: var(--cs-text); font-variant-numeric: tabular-nums; }
.cs-btnrow { display:flex; flex-wrap: wrap; gap: 6px; }
.layout-grid-item { border-color: #11161c !important; }
"""


def _letter(v) -> str:
    """Letra anatômica (RAS) da direção dominante de um vetor."""
    k = int(np.argmax(np.abs(v)))
    return ("RL", "AP", "SI")[k][0 if v[k] >= 0 else 1]


def _fmt(v: float, nd: int = 1) -> str:
    return f"{v:.{nd}f}".replace(".", ",")


class CatStudioApp(TrameApp):
    def __init__(self, server=None, *, local_mode: bool = True, initial_folder: str | None = None):
        super().__init__(server)
        self.server.enable_module(trame_slicer_module)
        self.local_mode = local_mode
        self.session = Session()
        self.slicer = SlicerApp()
        self.catalog: dicom_index.Catalog | None = None
        self.result = None
        self.sampler = None
        self.style = rendering.VolumeStyle(preset=DEFAULT_VR)
        self._busy_progress = 0.0
        self._spin_task = None
        self._probe_t = 0.0
        self._wl_guard = False
        self._display_obs = None
        self._initial_folder = initial_folder

        register_rca_factories(self.slicer.view_manager, self.server,
                               slice_view_ui_f=self._slice_view_ui, three_d_view_ui_f=self._threed_view_ui)
        self.layout_manager = LayoutManager(self.slicer.scene, self.slicer.view_manager, self.server)
        a = ViewLayoutDefinition.axial_view()
        c = ViewLayoutDefinition.coronal_view()
        s = ViewLayoutDefinition.sagittal_view()
        t = ViewLayoutDefinition.threed_view(background_color=BACKGROUNDS["Estúdio"])
        self.layout_manager.register_layout_dict({k: f(a, c, s, t) for k, f in LAYOUTS.items()})
        self.layout_manager.set_layout("Quatro quadrantes")

        self._init_state()
        self._init_views()
        self._build_ui()
        self._bind()
        self.server.controller.on_server_ready.add(lambda **_: asyncio.ensure_future(self._on_ready()))
        self.server.controller.on_server_exited.add(lambda **_: self.session.cleanup())

    # ------------------------------------------------------------------ estado
    def _init_state(self):
        st = self.state
        st.trame__title = "CatStudio"
        st.update({
            "cs_busy": False, "cs_progress": 0, "cs_status": "Importe uma pasta DICOM para começar.",
            "cs_error": "", "cs_notice": "", "cs_studies": [], "cs_stack_items": [], "cs_stack": None,
            "cs_skipped": "", "cs_info": None, "cs_exam": "", "cs_loaded": False, "cs_local_mode": self.local_mode,
            "cs_local_path": "", "cs_confirm_open": False, "cs_confirm_msgs": [], "cs_confirm_id": None,
            "cs_layout": "Quatro quadrantes", "cs_layouts": list(LAYOUTS),
            "cs_ww": 400, "cs_wl": 40, "cs_wl_presets": list(WINDOW_PRESETS), "cs_has_dicom_wl": False,
            "cs_vr_visible": True, "cs_vr_preset": DEFAULT_VR, "cs_vr_presets": list(VR_PRESETS),
            "cs_vr_shift": 0, "cs_vr_shift_min": -500, "cs_vr_shift_max": 500, "cs_vr_opacity": 100,
            "cs_vr_palette": "Original do Slicer", "cs_vr_palettes": list(PALETTES), "cs_bg": "Estúdio",
            "cs_bgs": list(BACKGROUNDS), "cs_vr_quality": "Normal", "cs_vr_qualities": list(QUALITY),
            "cs_vr_smooth": True, "cs_planes_3d": False, "cs_spin": False,
            "cs_slab": "Desligado", "cs_slabs": list(SLAB), "cs_slab_mm": 10, "cs_intersections": True,
            "cs_probe": "", "cs_version": __version__,
        })
        for tag in SLICE_VIEWS:
            st[f"cs_ov_{tag}"] = {"l": "", "r": "", "t": "", "b": "", "pos": ""}

    def _init_views(self):
        for v in self.slicer.view_manager.get_slice_views():
            v.set_ruler(vtkMRMLAbstractViewNode.RulerTypeThin, vtkMRMLAbstractViewNode.RulerColorWhite)
            v.modified.connect(self._update_overlay)
            self._update_overlay(v)
        for v in self.slicer.view_manager.get_threed_views():
            v.set_orientation_marker(vtkMRMLAbstractViewNode.OrientationMarkerTypeAxes,
                                     vtkMRMLAbstractViewNode.OrientationMarkerSizeSmall)
            v.set_box_visible(False)
        app_logic = self.slicer.app_logic
        app_logic.SetIntersectingSlicesEnabled(vtkMRMLApplicationLogic.IntersectingSlicesVisibility, True)
        crosshair = self.slicer.scene.GetFirstNodeByClass("vtkMRMLCrosshairNode")
        if crosshair is not None:
            crosshair.AddObserver(vtkMRMLCrosshairNode.CursorPositionModifiedEvent, self._on_cursor)

    def _threed(self):
        views = self.slicer.view_manager.get_threed_views()
        return views[0] if views else None

    # ------------------------------------------------------------------ vistas (sobreposições)
    def _slice_view_ui(self, server, view_id, view):
        create_vertical_slice_view_gutter_ui(server, view_id, view)
        tag = view.get_singleton_tag()
        name, color = SLICE_VIEWS.get(tag, (tag, "#fff"))
        ov = f"cs_ov_{tag}"
        html.Div(name.upper(), classes="cs-ov name", style=f"color:{color}")
        html.Div(f"{{{{ {ov}.l }}}}", classes="cs-ov l")
        html.Div(f"{{{{ {ov}.r }}}}", classes="cs-ov r")
        html.Div(f"{{{{ {ov}.t }}}}", classes="cs-ov t")
        html.Div(f"{{{{ {ov}.b }}}}", classes="cs-ov b")
        html.Div(f"{{{{ {ov}.pos }}}}", classes="cs-ov pos")

    def _threed_view_ui(self, server, view_id, view):
        create_vertical_view_gutter_ui(server, view_id, view)
        html.Div("3D STUDIO · SLICER VR", classes="cs-ov three")
        html.Div("Reconstrução volumétrica aparece aqui depois de carregar uma série.",
                 v_if="!cs_loaded", classes="cs-empty")

    def _update_overlay(self, view, *_):
        node = view.get_view_node()
        tag = view.get_singleton_tag()
        if node is None or tag not in SLICE_VIEWS:
            return
        m = node.GetSliceToRAS()
        x = np.array([m.GetElement(i, 0) for i in range(3)])
        y = np.array([m.GetElement(i, 1) for i in range(3)])
        n = np.array([m.GetElement(i, 2) for i in range(3)])
        o = np.array([m.GetElement(i, 3) for i in range(3)])
        n = n / (np.linalg.norm(n) or 1)
        p = float(o @ n)
        if abs(p) < 0.05:
            p = 0.0
        pos = f"{_letter(n if p >= 0 else -n)} {_fmt(abs(p))} mm"
        val = {"l": _letter(-x), "r": _letter(x), "t": _letter(y), "b": _letter(-y), "pos": pos}
        key = f"cs_ov_{tag}"
        if self.state[key] != val:
            self.state[key] = val
            self.state.flush()

    def _on_cursor(self, crosshair, _event):
        now = time.monotonic()
        if self.sampler is None or now - self._probe_t < 0.06:
            return
        self._probe_t = now
        ras = [0.0, 0.0, 0.0]
        if not crosshair.GetCursorPositionRAS(ras):
            return
        hu = self.sampler(ras)
        coords = " · ".join(f"{_letter(np.eye(3)[k] * (1 if ras[k] >= 0 else -1))} {_fmt(abs(ras[k]))}"
                            for k in range(3))
        self.state.cs_probe = f"{coords} mm" + (f"  ·  {hu:.0f} HU" if hu is not None else "  ·  fora do volume")
        self.state.flush()

    # ------------------------------------------------------------------ interface
    def _build_ui(self):
        with VAppLayout(self.server, theme="dark", full_height=True) as self.ui:
            client.Style(CSS)
            self._appbar()
            self._left()
            self._right()
            with v3.VMain(style="height: 100vh;"):
                with html.Div(style="position:relative; height: calc(100vh - 56px - 30px); display:flex;"):
                    self.layout_manager.initialize_layout_grid(self.ui)
                    v3.VAlert(v_if="cs_error", text=("cs_error",), type="error", variant="tonal", closable=True,
                              density="compact", style="position:absolute; top:10px; left:50%; "
                              "transform:translateX(-50%); z-index:20; max-width:720px;",
                              click_close="cs_error = ''")
                    v3.VAlert(v_if="cs_notice", text=("cs_notice",), type="warning", variant="tonal", closable=True,
                              density="compact", style="position:absolute; bottom:10px; left:50%; "
                              "transform:translateX(-50%); z-index:20; max-width:760px;",
                              click_close="cs_notice = ''")
            with v3.VFooter(app=True, height=30, classes="cs-foot px-3 d-flex"):
                html.Span("{{ cs_status }}")
                v3.VSpacer()
                html.Span("{{ cs_probe }}", classes="cs-probe mr-4")
                html.Span("Processamento local · núcleo 3D Slicer · v{{ cs_version }}")
            self._confirm_dialog()
            # entradas de arquivo invisíveis (o botão visível dispara o clique)
            upload = ("cs_busy = true; cs_error = ''; const el = $event.target; "
                      "window.load_files_by_chunks(el.files, { trigger_name: 'cs_upload_chunk' })"
                      ".then(r => trigger('cs_upload_done', [r.status, r.errorMsg || '']))"
                      ".finally(() => { el.value = ''; });")
            html.Input(id="cs-folder", type="file", style="display:none", multiple=True,
                       raw_attrs=["webkitdirectory", "directory"], change=upload)
            html.Input(id="cs-files", type="file", style="display:none", multiple=True, change=upload)

    def _appbar(self):
        with v3.VAppBar(height=56, flat=True, classes="cs-bar"):
            with html.Div(classes="d-flex flex-column ml-4 mr-6"):
                html.Div("Cat<span>Studio</span>", classes="cs-brand")
                html.Div("Cinematic Anatomical Tomography Studio", classes="cs-sub")
                html.Div("sobre o núcleo do 3D Slicer", classes="cs-sub")
            with v3.VBtn(variant="tonal", color="primary", classes="mr-2", disabled=("cs_busy",),
                         click="document.getElementById('cs-folder').click()", prepend_icon="mdi-folder-upload"):
                html.Span("Pasta DICOM")
            with v3.VBtn(variant="text", classes="mr-2", disabled=("cs_busy",),
                         click="document.getElementById('cs-files').click()", prepend_icon="mdi-file-upload"):
                html.Span("Arquivos / .zip")
            with v3.VMenu(v_if="cs_local_mode", close_on_content_click=False):
                with v3.Template(v_slot_activator="{ props }"):
                    with v3.VBtn(v_bind="props", variant="text", disabled=("cs_busy",), prepend_icon="mdi-harddisk"):
                        html.Span("Pasta local")
                with v3.VCard(width=480, classes="pa-3"):
                    html.Div("Caminho de uma pasta neste computador (mais rápido para exames grandes: "
                             "os arquivos são lidos no lugar, sem cópia).", classes="text-caption mb-2")
                    v3.VTextField(v_model=("cs_local_path",), density="compact", hide_details=True,
                                  placeholder=r"C:\Exames\TC_torax", variant="outlined")
                    v3.VBtn("Importar", classes="mt-2", color="primary", block=True, click=self.import_local_path)
            v3.VSelect(v_model=("cs_stack",), items=("cs_stack_items",), item_title="title", item_value="value",
                       label="Série", density="compact", hide_details=True, variant="outlined",
                       style="max-width: 360px; min-width: 220px;", classes="mx-4",
                       disabled=("cs_busy || !cs_stack_items.length",),
                       item_props=True, update_modelValue="trigger('cs_select', [$event])")
            html.Div("{{ cs_exam }}", classes="text-caption text-medium-emphasis",
                     style="max-width:320px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;")
            v3.VSpacer()
            v3.VSelect(v_model=("cs_layout",), items=("cs_layouts",), density="compact", hide_details=True,
                       variant="plain", style="max-width: 190px;", prepend_inner_icon="mdi-view-grid-outline")
            v3.VProgressLinear(v_if="cs_busy", model_value=("cs_progress",), color="cyan", absolute=True,
                               location="bottom", height=3, indeterminate=("cs_progress <= 0",))

    def _left(self):
        with v3.VNavigationDrawer(permanent=True, width=330, classes="cs-drawer px-3"):
            html.Div("Estudos e séries", classes="cs-h")
            html.Div("Nenhum exame importado.", v_if="!cs_studies.length", classes="text-caption text-medium-emphasis")
            with html.Div(v_for="st in cs_studies", key="st.uid", classes="mb-3"):
                html.Div("{{ st.title }}", classes="text-body-2 font-weight-bold")
                html.Div("{{ st.subtitle }}", classes="text-caption text-medium-emphasis")
                with html.Div(v_for="se in st.series", key="se.uid", classes="mt-2"):
                    html.Div("{{ se.title }}", classes="text-caption font-weight-medium")
                    with html.Div(v_for="sk in se.stacks", key="sk.id",
                                  classes=("['cs-stack', sk.id === cs_stack ? 'active' : '']",),
                                  click="cs_busy || trigger('cs_select', [sk.id])"):
                        with html.Div(classes="d-flex align-center"):
                            html.Span(classes=("['cs-dot', sk.status]",))
                            html.Span("{{ sk.label }}", classes="text-caption font-weight-medium")
                            v3.VSpacer()
                            html.Span("{{ sk.n }} img", classes="text-caption text-medium-emphasis")
                        html.Div("{{ sk.dims }} · {{ sk.plane }} · {{ sk.spacing }}",
                                 v_if="sk.spacing", classes="text-caption text-medium-emphasis")
                        html.Div("{{ m }}", v_for="m in sk.messages", classes=("['cs-msg', sk.status]",))
            html.Div("{{ cs_skipped }}", v_if="cs_skipped", classes="cs-msg mt-1")

            html.Div("Volume carregado", classes="cs-h", v_if="cs_info")
            with html.Div(v_if="cs_info", classes="cs-kv"):
                for label, key in [("Série", "series"), ("Matriz", "dims"), ("Voxel", "spacing"),
                                   ("Extensão", "extent"), ("Aquisição", "plane"), ("Orientação IJK", "orient"),
                                   ("Faixa", "hu"), ("Leitor", "reader"), ("Geometria", "check")]:
                    html.B(label)
                    html.Span(f"{{{{ cs_info.{key} }}}}")
            html.Div("{{ m }}", v_for="m in (cs_info ? cs_info.messages : [])", classes="cs-msg aviso")

            html.Div("Janela (2D)", classes="cs-h")
            with html.Div(classes="cs-btnrow"):
                v3.VBtn("{{ p }}", v_for="p in cs_wl_presets", size="small", variant="tonal",
                        disabled=("!cs_loaded",), click="trigger('cs_wl_preset', [p])")
                v3.VBtn("DICOM", v_if="cs_has_dicom_wl", size="small", variant="tonal", disabled=("!cs_loaded",),
                        click="trigger('cs_wl_preset', ['DICOM'])")
            with html.Div(classes="d-flex mt-3", style="gap: 8px;"):
                v3.VTextField(v_model_number=("cs_ww",), label="Largura (W)", type="number", density="compact",
                              hide_details=True, variant="outlined", disabled=("!cs_loaded",))
                v3.VTextField(v_model_number=("cs_wl",), label="Nível (L)", type="number", density="compact",
                              hide_details=True, variant="outlined", disabled=("!cs_loaded",))
            html.Div("Arraste com o botão esquerdo numa vista 2D para ajustar a janela.", classes="cs-msg mt-1")

    def _right(self):
        with v3.VNavigationDrawer(permanent=True, width=320, location="right", classes="cs-drawer px-3"):
            html.Div("Reconstrução 3D", classes="cs-h")
            v3.VSwitch(v_model=("cs_vr_visible",), label="Mostrar volume", density="compact", hide_details=True,
                       color="cyan", disabled=("!cs_loaded",))
            v3.VSelect(v_model=("cs_vr_preset",), items=("cs_vr_presets",), label="Estilo (preset do Slicer)",
                       density="compact", hide_details=True, variant="outlined", classes="mt-2",
                       disabled=("!cs_loaded",))
            html.Div("Limiar / deslocamento: {{ cs_vr_shift }} HU", classes="text-caption mt-3")
            v3.VSlider(v_model=("cs_vr_shift",), min=("cs_vr_shift_min",), max=("cs_vr_shift_max",), step=5,
                       density="compact", hide_details=True, color="cyan", disabled=("!cs_loaded",))
            html.Div("Opacidade: {{ cs_vr_opacity }}%", classes="text-caption")
            v3.VSlider(v_model=("cs_vr_opacity",), min=0, max=200, step=5, density="compact", hide_details=True,
                       color="cyan", disabled=("!cs_loaded",))
            v3.VSelect(v_model=("cs_vr_palette",), items=("cs_vr_palettes",), label="Cores", density="compact",
                       hide_details=True, variant="outlined", disabled=("!cs_loaded",))
            with html.Div(classes="d-flex mt-2", style="gap:8px"):
                v3.VSelect(v_model=("cs_bg",), items=("cs_bgs",), label="Fundo", density="compact", hide_details=True,
                           variant="outlined")
                v3.VSelect(v_model=("cs_vr_quality",), items=("cs_vr_qualities",), label="Qualidade",
                           density="compact", hide_details=True, variant="outlined")
            v3.VSwitch(v_model=("cs_vr_smooth",), label="Suavizar superfícies", density="compact", hide_details=True,
                       color="cyan")
            v3.VSwitch(v_model=("cs_planes_3d",), label="Planos MPR dentro do 3D", density="compact",
                       hide_details=True, color="cyan", disabled=("!cs_loaded",))

            html.Div("Câmera 3D", classes="cs-h")
            with html.Div(classes="cs-btnrow"):
                for letter, title, direction in CAMERA_VIEWS:
                    with v3.VBtn(letter, size="small", variant="tonal", min_width=36,
                                 click=(self.camera_view, f"['{direction.name}']")):
                        v3.VTooltip(title, activator="parent", location="bottom")
            with html.Div(classes="cs-btnrow mt-2"):
                for icon, tip, axis, ang in [("mdi-rotate-left", "Girar 15° à esquerda (eixo craniocaudal)", "S", -15),
                                             ("mdi-rotate-right", "Girar 15° à direita (eixo craniocaudal)", "S", 15),
                                             ("mdi-arrow-up", "Inclinar 15° para cima (eixo D–E)", "R", -15),
                                             ("mdi-arrow-down", "Inclinar 15° para baixo (eixo D–E)", "R", 15)]:
                    with v3.VBtn(size="small", variant="tonal", min_width=36,
                                 click=(self.camera_rotate, f"['{axis}', {ang}]")):
                        v3.VIcon(icon, size="small")
                        v3.VTooltip(tip, activator="parent", location="bottom")
                for icon, tip, fn in [("mdi-magnify-plus-outline", "Aproximar", self.zoom_in),
                                      ("mdi-magnify-minus-outline", "Afastar", self.zoom_out),
                                      ("mdi-fit-to-screen-outline", "Recentralizar", self.reset_3d)]:
                    with v3.VBtn(size="small", variant="tonal", min_width=36, click=fn):
                        v3.VIcon(icon, size="small")
                        v3.VTooltip(tip, activator="parent", location="bottom")
            v3.VSwitch(v_model=("cs_spin",), label="Girar continuamente", density="compact", hide_details=True,
                       color="cyan", disabled=("!cs_loaded",))
            v3.VBtn("Salvar imagem 3D (PNG)", block=True, variant="tonal", prepend_icon="mdi-camera",
                    disabled=("!cs_loaded",),
                    click="utils.download('catstudio-3d.png', trigger('cs_snapshot'), 'image/png')")

            html.Div("Cortes (MPR)", classes="cs-h")
            with html.Div(classes="d-flex", style="gap:8px"):
                v3.VSelect(v_model=("cs_slab",), items=("cs_slabs",), label="Slab", density="compact",
                           hide_details=True, variant="outlined", disabled=("!cs_loaded",), style="flex: 1.3")
                v3.VTextField(v_model_number=("cs_slab_mm",), label="mm", type="number", style="flex: 1",
                              density="compact", hide_details=True, variant="outlined",
                              disabled=("!cs_loaded || cs_slab === 'Desligado'",))
            v3.VSwitch(v_model=("cs_intersections",), label="Linhas de referência entre planos", density="compact",
                       hide_details=True, color="cyan")
            v3.VBtn("Recentralizar vistas 2D", block=True, variant="text", prepend_icon="mdi-crop-free",
                    click=self.reset_2d, disabled=("!cs_loaded",))

            html.Div("Mouse", classes="cs-h")
            for line in ["2D: roda = cortes · Ctrl+roda ou botão direito = zoom",
                         "2D: botão do meio ou Shift+arrastar = mover · esquerdo = janela",
                         "2D: Shift+mover = cruzar os planos no ponto",
                         "3D: esquerdo = girar · direito/Ctrl+roda = zoom · meio = mover"]:
                html.Div(line, classes="cs-msg")
            html.Div("Próxima etapa", classes="cs-h")
            html.Div("Iluminação cinematográfica (sombras, oclusão ambiente, dispersão) será adicionada sobre "
                     "este mesmo volume na Etapa 2.", classes="cs-msg")

    def _confirm_dialog(self):
        with v3.VDialog(v_model=("cs_confirm_open",), max_width=560), v3.VCard(classes="pa-4"):
            html.Div("Esta série tem problemas de geometria", classes="text-h6 mb-2")
            html.Div("{{ m }}", v_for="m in cs_confirm_msgs", classes="cs-msg aviso mb-1")
            html.Div("Se carregar, as posições anatômicas continuam corretas, mas o conteúdo nas faixas indicadas "
                     "será interpolado pelo Slicer, não medido.", classes="cs-msg mt-2")
            with v3.VCardActions():
                v3.VSpacer()
                v3.VBtn("Cancelar", variant="text", click="cs_confirm_open = false")
                v3.VBtn("Carregar mesmo assim", color="warning", variant="tonal",
                        click="cs_confirm_open = false; trigger('cs_select_confirmed', [cs_confirm_id])")

    # ------------------------------------------------------------------ ligações de estado
    def _bind(self):
        st, srv = self.state, self.server
        srv.trigger("cs_upload_chunk")(self.upload_chunk)
        srv.trigger("cs_upload_done")(self.upload_done)
        srv.trigger("cs_select")(self.select_stack)
        srv.trigger("cs_select_confirmed")(self.select_confirmed)
        srv.trigger("cs_wl_preset")(self.window_preset)
        srv.trigger("cs_snapshot")(self.snapshot)
        st.change("cs_ww", "cs_wl")(self._on_wl)
        st.change("cs_vr_preset")(self._on_vr_preset)
        st.change("cs_vr_shift", "cs_vr_opacity", "cs_vr_palette")(self._on_vr_style)
        st.change("cs_vr_visible")(self._on_vr_visible)
        st.change("cs_bg")(self._on_bg)
        st.change("cs_vr_quality", "cs_vr_smooth")(self._on_quality)
        st.change("cs_planes_3d")(self._on_planes_3d)
        st.change("cs_spin")(self._on_spin)
        st.change("cs_slab", "cs_slab_mm")(self._on_slab)
        st.change("cs_intersections")(self._on_intersections)
        st.change("cs_layout")(self._on_layout)

    async def _on_ready(self, **_):
        if self._initial_folder:
            await self._index_path(self._initial_folder, keep_files_in_place=True)

    # ------------------------------------------------------------------ importação
    async def upload_chunk(self, files):
        if files:
            if self.session.batch is None:
                self.session.new_batch()
            for f in files:
                content = f.get("content")
                if isinstance(content, list):
                    content = b"".join(content)
                if content:
                    self.session.write(f.get("name", ""), content)
            with self.state:
                self.state.cs_status = f"Recebendo arquivos… {self.session.counter}"

    async def upload_done(self, ok, error_msg=""):
        batch = self.session.batch
        self.session.batch = None
        if not ok or not batch:
            with self.state:
                self.state.cs_busy = False
                self.state.cs_error = f"Falha no envio dos arquivos: {error_msg or 'nenhum arquivo recebido'}"
            return
        self.session.batch = batch
        await asyncio.to_thread(self.session.expand_zips)
        self.session.batch = None
        await self._index_path(batch, keep_files_in_place=False)

    async def import_local_path(self):
        path = (self.state.cs_local_path or "").strip().strip('"')
        if not self.local_mode:
            return
        if not path or not os.path.isdir(path):
            with self.state:
                self.state.cs_error = "Pasta não encontrada neste computador."
            return
        await self._index_path(path, keep_files_in_place=True)

    async def _index_path(self, path: str, keep_files_in_place: bool):
        with self.state:
            self.state.cs_busy = True
            self.state.cs_progress = 0
            self.state.cs_error = ""
            self.state.cs_status = "Lendo cabeçalhos DICOM…"
        self._busy_progress = 0.0
        poller = asyncio.ensure_future(self._poll_progress())
        try:
            def work():
                files, skipped = dicom_index.list_files(path)
                return dicom_index.build_catalog(files, lambda p: setattr(self, "_busy_progress", p), skipped)

            cat = await asyncio.to_thread(work)
        except Exception as e:  # noqa: BLE001
            log.exception("falha ao indexar")
            with self.state:
                self.state.cs_busy = False
                self.state.cs_error = f"Não foi possível ler a pasta: {e}"
            return
        finally:
            poller.cancel()
        if not keep_files_in_place:
            # mantém só o lote atual na pasta temporária
            self.session.clear_old_batches(keep=path)
        self.catalog = cat
        n_stacks = sum(1 for _ in cat.stacks())
        with self.state:
            self.state.cs_busy = False
            self.state.cs_progress = 100
            self.state.cs_studies = self._studies_state(cat)
            self.state.cs_stack_items = [
                {"title": f"{se.number if se.number is not None else '–'} · {se.description} · {s.label}",
                 "value": s.id, "props": {"disabled": s.status == "erro"}}
                for st in cat.studies for se in st.series for s in se.stacks]
            self.state.cs_skipped = (f"Ignorados: {cat.skipped_text()}." if cat.skipped else "")
            self.state.cs_status = (f"{cat.n_files} arquivo(s) · {len(cat.studies)} estudo(s) · {n_stacks} pilha(s) "
                                    "de imagens. Escolha a série.") if n_stacks else \
                "Nenhuma imagem DICOM utilizável encontrada."
            if not n_stacks:
                self.state.cs_error = "Nenhuma imagem DICOM utilizável encontrada na seleção."
        loadable = [s for s in cat.stacks() if s.status != "erro"]
        if len(loadable) == 1 and not loadable[0].needs_confirmation:
            await self.select_stack(loadable[0].id)

    async def _poll_progress(self):
        while True:
            await asyncio.sleep(0.2)
            with self.state:
                self.state.cs_progress = round(100 * self._busy_progress)

    @staticmethod
    def _studies_state(cat):
        out = []
        for st in cat.studies:
            date = st.date
            date = f"{date[6:8]}/{date[4:6]}/{date[0:4]}" if len(date) == 8 else (date or "data desconhecida")
            mods = sorted({se.modality for se in st.series})
            out.append({
                "uid": st.uid, "title": st.description, "subtitle": f"{date} · {', '.join(mods)}",
                "series": [{"uid": se.uid,
                            "title": f"{se.number if se.number is not None else '–'} · {se.description} "
                                     f"({se.modality}, {se.n} img)",
                            "stacks": [s.summary() for s in se.stacks]} for se in st.series],
            })
        return out

    # ------------------------------------------------------------------ seleção e carga
    async def select_stack(self, stack_id):
        if not self.catalog or not stack_id:
            return
        s = self.catalog.stack(stack_id)
        if s is None:
            return
        if s.status == "erro":
            with self.state:
                self.state.cs_error = f"{s.label}: " + " ".join(s.messages)
                self.state.cs_stack = self.result and self.result.stack_id
            return
        if s.needs_confirmation:
            with self.state:
                self.state.cs_confirm_msgs = s.messages
                self.state.cs_confirm_id = s.id
                self.state.cs_confirm_open = True
            return
        await self._load(s)

    async def select_confirmed(self, stack_id):
        s = self.catalog.stack(stack_id) if self.catalog else None
        if s is not None:
            await self._load(s)

    async def _load(self, stack):
        with self.state:
            self.state.cs_busy = True
            self.state.cs_progress = 0
            self.state.cs_status = f"Montando o volume no Slicer ({len(stack.instances)} imagens)…"
            self.state.cs_error = ""
            self.state.cs_stack = stack.id
            self.state.cs_spin = False
        await asyncio.sleep(0.05)
        self._remove_current_volume()
        t0 = time.time()
        try:
            res = load_stack(self.slicer, stack)
        except Exception as e:  # noqa: BLE001
            log.exception("falha ao carregar")
            with self.state:
                self.state.cs_busy = False
                self.state.cs_loaded = False
                self.state.cs_error = f"O Slicer não conseguiu montar o volume: {e}"
            return
        res.stack_id = stack.id
        self.result = res
        node = res.volume_node
        self.sampler = VolumeSampler(node)
        self.slicer.display_manager.show_volume(node, vr_preset=VR_PRESETS[self.style.preset], do_reset_views=True)
        standard_planes(self.slicer.view_manager.get_slice_views(), self._volume_center(node))
        self._observe_display(node)
        f = stack.first
        wl = f.window if f.window else WINDOW_PRESETS["Partes moles"][::-1]
        lo, hi = rendering.shift_range(self.slicer.volume_rendering, self.style.preset)
        with self.state:
            self.state.cs_has_dicom_wl = bool(f.window)
            self.state.cs_ww, self.state.cs_wl = float(wl[1]), float(wl[0])
            self.state.cs_vr_shift_min, self.state.cs_vr_shift_max = lo, hi
            self.state.cs_info = self._info(stack, res)
            se = next(se for st in self.catalog.studies for se in st.series if se.uid == stack.series_uid)
            study = next(st for st in self.catalog.studies if st.uid == stack.study_uid)
            self.state.cs_exam = f"{study.description} · {se.description} · {se.modality}"
            self.state.cs_loaded = True
            self.state.cs_busy = False
            self.state.cs_progress = 100
            self.state.cs_status = f"Volume pronto em {time.time() - t0:.1f} s."
            notes = [m for m in (*stack.messages, *res.messages) if "Posições repetidas" not in m]
            self.state.cs_notice = " ".join(notes) if (stack.status == "aviso" or res.messages) else ""
        self._apply_wl()
        self._apply_style()
        self._on_quality()
        self._on_bg()
        self._on_slab()
        self._on_planes_3d()
        inter = self.slicer.app_logic.GetInteractionNode()
        if inter is not None:
            inter.SetCurrentInteractionMode(vtkMRMLInteractionNode.AdjustWindowLevel)
        self._render_all()

    @staticmethod
    def _volume_center(node):
        b = [0.0] * 6
        node.GetRASBounds(b)
        return ((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2)

    def reset_2d(self):
        node = self.result.volume_node if self.result else None
        standard_planes(self.slicer.view_manager.get_slice_views(), self._volume_center(node) if node else None)

    def _remove_current_volume(self):
        if self.result is None:
            return
        node = self.result.volume_node
        scene = self.slicer.scene
        if self._display_obs is not None:
            dn, tag = self._display_obs
            dn.RemoveObserver(tag)
            self._display_obs = None
        for i in reversed(range(node.GetNumberOfDisplayNodes())):
            d = node.GetNthDisplayNode(i)
            if d is None:
                continue
            prop = d.GetVolumePropertyNode() if hasattr(d, "GetVolumePropertyNode") else None
            scene.RemoveNode(d)
            if prop is not None:
                scene.RemoveNode(prop)
        if node.GetStorageNode() is not None:
            scene.RemoveNode(node.GetStorageNode())
        scene.RemoveNode(node)
        self.result = None
        self.sampler = None

    def _info(self, stack, res):
        g = stack.geometry
        M = res.ijk_to_ras
        orient = "".join(_letter(M[:3, k]) for k in range(3))
        sp = res.spacing
        dims = res.dims
        tilt = f" · gantry {geometry.fmt_mm(g.tilt_deg, 1)}°" if g and g.tilt_deg else ""
        return {
            "series": stack.label,
            "dims": f"{dims[0]} × {dims[1]} × {dims[2]}",
            "spacing": " × ".join(geometry.fmt_mm(v, 3) for v in sp) + " mm",
            "extent": " × ".join(geometry.fmt_mm(d * s, 0) for d, s in zip(dims, sp)) + " mm",
            "plane": (g.plane if g else "?") + tilt,
            "orient": f"{orient} (eixos i, j, k em RAS)",
            "hu": f"{res.hu_range[0]:.0f} a {res.hu_range[1]:.0f} HU",
            "reader": "3D Slicer · vtkITK (GDCM/DCMTK)",
            "check": ("conferida ✓ (desvio " + geometry.fmt_mm(res.check_mm, 3) + " mm)") if res.check_mm is not None
            and res.check_mm <= 0.5 else (f"desvio {geometry.fmt_mm(res.check_mm)} mm" if res.check_mm else "—"),
            "messages": res.messages,
        }

    # ------------------------------------------------------------------ janela 2D
    def _observe_display(self, node):
        dn = node.GetDisplayNode()
        if dn is None:
            return
        tag = dn.AddObserver(vtkCommand.ModifiedEvent, self._on_display_modified)
        self._display_obs = (dn, tag)

    def _on_display_modified(self, dn, _ev):
        if self._wl_guard:
            return
        ww, wl = round(dn.GetWindow(), 1), round(dn.GetLevel(), 1)
        if (ww, wl) != (self.state.cs_ww, self.state.cs_wl):
            self._wl_guard = True
            self.state.cs_ww, self.state.cs_wl = ww, wl
            self.state.flush()
            self._wl_guard = False

    def window_preset(self, name):
        if name == "DICOM" and self.result is not None:
            s = self.catalog.stack(self.result.stack_id)
            if s and s.first.window:
                c, w = s.first.window
                self.state.cs_ww, self.state.cs_wl = float(w), float(c)
            return
        if name in WINDOW_PRESETS:
            self.state.cs_ww, self.state.cs_wl = WINDOW_PRESETS[name]

    def _on_wl(self, **_):
        if not self._wl_guard:
            self._apply_wl()

    def _apply_wl(self):
        if self.result is None:
            return
        dn = self.result.volume_node.GetDisplayNode()
        try:
            ww = max(1.0, float(self.state.cs_ww))
            wl = float(self.state.cs_wl)
        except (TypeError, ValueError):
            return
        self._wl_guard = True
        try:
            dn.AutoWindowLevelOff()
            dn.SetWindowLevel(ww, wl)
        finally:
            self._wl_guard = False

    # ------------------------------------------------------------------ 3D
    def _apply_style(self):
        if self.result is None:
            return
        t = self._threed()
        rendering.apply_style(self.slicer.volume_rendering, self.result.volume_node, self.style,
                              [t] if t else [])
        self._on_vr_visible()
        if t:
            t.schedule_render()

    def _on_vr_preset(self, cs_vr_preset, **_):
        self.style.preset = cs_vr_preset
        lo, hi = rendering.shift_range(self.slicer.volume_rendering, cs_vr_preset)
        self.state.cs_vr_shift_min, self.state.cs_vr_shift_max = lo, hi
        self.style.shift = 0
        if self.state.cs_vr_shift != 0:
            self.state.cs_vr_shift = 0      # dispara _on_vr_style, que reaplica
        else:
            self._apply_style()

    def _on_vr_style(self, cs_vr_shift, cs_vr_opacity, cs_vr_palette, **_):
        self.style.shift = float(cs_vr_shift or 0)
        self.style.opacity = float(cs_vr_opacity if cs_vr_opacity is not None else 100)
        self.style.palette = cs_vr_palette
        self._apply_style()

    def _on_vr_visible(self, **_):
        if self.result is None:
            return
        d = self.slicer.volume_rendering.get_vr_display_node(self.result.volume_node)
        if d is not None:
            d.SetVisibility(bool(self.state.cs_vr_visible))

    def _on_bg(self, **_):
        t = self._threed()
        if t:
            c1, c2 = BACKGROUNDS.get(self.state.cs_bg, BACKGROUNDS["Estúdio"])
            t.set_background_color_from_string((c1, c2))
            t.schedule_render()

    def _on_quality(self, **_):
        t = self._threed()
        vn = t.get_view_node() if t else None
        if vn is None:
            return
        vn.SetVolumeRenderingQuality(QUALITY.get(self.state.cs_vr_quality, vtkMRMLViewNode.Normal))
        vn.SetVolumeRenderingSurfaceSmoothing(bool(self.state.cs_vr_smooth))
        t.schedule_render()

    def _on_planes_3d(self, **_):
        for v in self.slicer.view_manager.get_slice_views():
            v.set_visible_in_3d(bool(self.state.cs_planes_3d) and self.result is not None)

    def camera_view(self, direction_name):
        t = self._threed()
        if t:
            t.rotate_to_view_direction(ViewDirection[direction_name])
            t.schedule_render()

    def camera_rotate(self, axis, angle):
        t = self._threed()
        cam = t.get_camera_node() if t else None
        if cam is None:
            return
        cam.RotateAround(getattr(vtkMRMLCameraNode, axis), float(angle))
        t.schedule_render()

    def zoom_in(self):
        t = self._threed()
        if t:
            t.zoom_in()

    def zoom_out(self):
        t = self._threed()
        if t:
            t.zoom_out()

    def reset_3d(self):
        t = self._threed()
        if t:
            t.reset_view()

    def _on_spin(self, cs_spin, **_):
        if cs_spin and self._spin_task is None:
            self._spin_task = asyncio.ensure_future(self._spin())
        elif not cs_spin and self._spin_task is not None:
            self._spin_task.cancel()
            self._spin_task = None

    async def _spin(self):
        try:
            while True:
                t = self._threed()
                cam = t.get_camera_node() if t else None
                if cam is not None and self.result is not None:
                    cam.RotateAround(vtkMRMLCameraNode.S, 2.0)
                    t.schedule_render()
                await asyncio.sleep(1 / 24)
        except asyncio.CancelledError:
            pass

    def snapshot(self):
        t = self._threed()
        if t is None:
            return None
        rw = t.render_window()
        t.render()
        w2i = vtkWindowToImageFilter()
        w2i.SetInput(rw)
        w2i.SetInputBufferTypeToRGB()
        w2i.ReadFrontBufferOff()
        w2i.Update()
        png = vtkPNGWriter()
        png.SetInputConnection(w2i.GetOutputPort())
        png.WriteToMemoryOn()
        png.Write()
        data = bytes(memoryview(png.GetResult()))
        return self.server.protocol.addAttachment(data)

    # ------------------------------------------------------------------ 2D
    def _on_slab(self, **_):
        mode = SLAB.get(self.state.cs_slab)
        try:
            mm = max(0.5, float(self.state.cs_slab_mm or 1))
        except (TypeError, ValueError):
            mm = 10.0
        kind = {"max": VTK_IMAGE_SLAB_MAX, "min": VTK_IMAGE_SLAB_MIN, "mean": VTK_IMAGE_SLAB_MEAN}
        for v in self.slicer.view_manager.get_slice_views():
            v.set_slab_enabled(mode is not None)
            if mode is not None:
                v.set_slab_type(kind[mode])
                v.set_slab_thickness(mm)

    def _on_intersections(self, cs_intersections, **_):
        self.slicer.app_logic.SetIntersectingSlicesEnabled(vtkMRMLApplicationLogic.IntersectingSlicesVisibility,
                                                           bool(cs_intersections))
        self._render_all()

    def _on_layout(self, cs_layout, **_):
        if cs_layout in LAYOUTS:
            self.layout_manager.set_layout(cs_layout)

    def _render_all(self):
        for v in self.slicer.view_manager.get_views():
            v.schedule_render()

