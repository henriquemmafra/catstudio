"""Controle da reconstrução 3D sobre o volume rendering nativo do 3D Slicer.

Nada aqui desenha pixels: tudo é aplicado nas funções de transferência e nos nós MRML
(vtkMRMLVolumePropertyNode, vtkMRMLViewNode, vtkMRMLCameraNode) que o renderizador GPU
do Slicer (vtkMRMLGPURayCastVolumeRenderingDisplayNode) já usa.

Cada ajuste é recalculado a partir do preset original (estado absoluto), então mover um
controle várias vezes nunca acumula erro.
"""

from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass

from slicer import vtkMRMLViewNode
from vtkmodules.vtkCommonDataModel import vtkPiecewiseFunction
from vtkmodules.vtkRenderingCore import vtkColorTransferFunction

from .presets import MIP_PRESETS, PALETTES, VR_PRESETS, palette_color


@dataclass
class VolumeStyle:
    preset: str = "Osso"          # rótulo em VR_PRESETS
    shift: float = 0.0            # HU somados a todos os pontos das funções de transferência
    opacity: float = 100.0        # % multiplicando a opacidade escalar
    palette: str = "Original do Slicer"


def _visible_range(opacity_points: list[list[float]]) -> tuple[float, float]:
    xs = [p[0] for p in opacity_points if p[1] > 0.005]
    if not xs:
        xs = [p[0] for p in opacity_points]
    lo, hi = min(xs), max(xs)
    if hi - lo < 1:
        hi = lo + 1
    return lo, hi


def styled_functions(vr, style: VolumeStyle) -> tuple[list[list[float]], list[list[float]]]:
    """(cores, opacidades) do preset do Slicer com deslocamento, opacidade e paleta aplicados."""
    base = vr.get_preset_property(VR_PRESETS[style.preset])
    colors = [list(p) for p in (base.get_color_map_values() or [])]
    opac = [list(p) for p in (base.get_opacity_map_values() or [])]
    for p in colors:
        p[0] += style.shift
    for p in opac:
        p[0] += style.shift
    f = max(0.0, style.opacity) / 100.0
    for p in opac:
        p[1] = min(1.0, p[1] * f)
    stops = PALETTES.get(style.palette)
    if stops:
        lo, hi = _visible_range(opac)
        n = 12
        colors = []
        for k in range(n + 1):
            x = lo + (hi - lo) * k / n
            colors.append([x, *palette_color(stops, k / n), 0.5, 0.0])
        colors.insert(0, [lo - 2000.0, *palette_color(stops, 0.0), 0.5, 0.0])
        colors.append([hi + 2000.0, *palette_color(stops, 1.0), 0.5, 0.0])
    return colors, opac


def apply_style(vr, volume_node, style: VolumeStyle, views) -> None:
    """Aplica o estilo. `views`: vistas 3D do trame-slicer (ThreeDView).

    A renderização fica bloqueada durante a troca das funções de transferência: uma renderização
    no meio da troca (função com 1–2 pontos) faz a cadeia de volume rendering completar a função
    com pontos nos extremos da faixa de HU, que depois sobrevivem — estruturas densas reapareciam
    mesmo com opacidade 0.
    """
    with ExitStack() as stack:
        for v in views:
            stack.enter_context(v.render_blocked())
        display = vr.get_vr_display_node(volume_node) or vr.create_display_node(volume_node, VR_PRESETS[style.preset])
        vr.apply_preset(display, VR_PRESETS[style.preset])        # sombreamento/iluminação do preset do Slicer
        colors, opac = styled_functions(vr, style)
        vp = display.GetVolumePropertyNode().GetVolumeProperty()
        replace_points(vp.GetRGBTransferFunction(), colors)
        replace_points(vp.GetScalarOpacity(), opac)
        technique = (vtkMRMLViewNode.MaximumIntensityProjection if VR_PRESETS[style.preset] in MIP_PRESETS
                     else vtkMRMLViewNode.Composite)
        for v in views:
            vn = v.get_view_node()
            if vn is not None and vn.GetRaycastTechnique() != technique:
                vn.SetRaycastTechnique(technique)
        display.SetVisibility(True)
    for v in views:
        v.schedule_render()


def replace_points(function, points) -> None:
    """Troca todos os pontos de uma função de transferência numa única operação.

    Esvaziar a função e reinseri-la ponto a ponto (RemoveAllPoints + AddPoint) deixa um estado
    intermediário vazio que a lógica de volume rendering do Slicer observa e "completa" com pontos
    nos extremos da faixa de HU do exame — o que reacende estruturas densas mesmo com opacidade 0.
    Montar a função ao lado e copiá-la com DeepCopy evita esse estado.
    """
    if isinstance(function, vtkColorTransferFunction):
        tmp = vtkColorTransferFunction()
        for p in points:
            tmp.AddRGBPoint(*p)
    else:
        tmp = vtkPiecewiseFunction()
        for p in points:
            tmp.AddPoint(*p)
    function.DeepCopy(tmp)


def shift_range(vr, preset_label: str) -> tuple[float, float]:
    lo, hi = vr.get_preset_vr_shift_range(VR_PRESETS[preset_label])
    span = max(200.0, min(abs(lo), abs(hi), 1500.0))
    return -span, span
