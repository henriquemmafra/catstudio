"""Presets do CatStudio: janelas 2D (HU) e estilos de reconstrução 3D.

Os estilos 3D apontam para presets NATIVOS do 3D Slicer (Modules/Loadable/VolumeRendering/
Resources/presets.xml), carregados pela própria lógica de volume rendering do Slicer. O
CatStudio só escolhe, renomeia e aplica ajustes (deslocamento, opacidade, paleta) por cima.
"""

from __future__ import annotations

# janela 2D: (largura, nível) em HU
WINDOW_PRESETS: dict[str, tuple[float, float]] = {
    "Pulmão": (1500, -600),
    "Mediastino": (350, 40),
    "Partes moles": (400, 50),
    "Osso": (1800, 400),
}

# estilo 3D: rótulo → nome do preset do Slicer
VR_PRESETS: dict[str, str] = {
    "Osso": "CT-Bone",
    "Esqueleto (alto contraste)": "CT-Bones",
    "Tórax com contraste": "CT-Chest-Contrast-Enhanced",
    "Vasos do tórax": "CT-Chest-Vessels",
    "Artérias pulmonares": "CT-Pulmonary-Arteries",
    "Cardíaco": "CT-Cardiac3",
    "Coronárias": "CT-Coronary-Arteries-3",
    "Pulmão": "CT-Lung",
    "Vias aéreas": "CT-Air",
    "Partes moles": "CT-Soft-Tissue",
    "Músculo": "CT-Muscle",
    "Gordura": "CT-Fat",
    "MIP (projeção de intensidade máxima)": "CT-MIP",
    "Radiografia simulada": "CT-X-ray",
}
DEFAULT_VR = "Osso"
MIP_PRESETS = {"CT-MIP"}

# paletas: lista de (t ∈ [0,1], (r, g, b)) aplicada sobre a faixa visível do preset
PALETTES: dict[str, list[tuple[float, tuple[float, float, float]]] | None] = {
    "Original do Slicer": None,
    "Marfim": [(0.0, (0.30, 0.12, 0.06)), (0.35, (0.82, 0.52, 0.36)), (0.7, (0.97, 0.90, 0.78)),
               (1.0, (1.0, 0.99, 0.96))],
    "Cinematográfico quente": [(0.0, (0.28, 0.03, 0.03)), (0.4, (0.78, 0.26, 0.13)), (0.75, (0.98, 0.74, 0.50)),
                               (1.0, (1.0, 0.97, 0.90))],
    "Frio": [(0.0, (0.03, 0.06, 0.20)), (0.5, (0.30, 0.58, 0.85)), (1.0, (0.92, 0.97, 1.0))],
    "Monocromático": [(0.0, (0.15, 0.15, 0.15)), (1.0, (1.0, 1.0, 1.0))],
}

BACKGROUNDS: dict[str, tuple[str, str]] = {
    "Estúdio": ("#05070a", "#27313b"),
    "Preto": ("#000000", "#000000"),
    "Grafite": ("#2b2f33", "#2b2f33"),
    "Branco": ("#ffffff", "#ffffff"),
}

# orientação de cada vista 2D (rótulo, cor) — cores herdadas da convenção do Slicer
SLICE_VIEWS = {
    "Red": ("Axial", "#F34A33"),
    "Green": ("Coronal", "#6DAD4A"),
    "Yellow": ("Sagital", "#EFD64D"),
}


def palette_color(stops, t: float) -> tuple[float, float, float]:
    t = min(1.0, max(0.0, t))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            u = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return tuple(a + (b - a) * u for a, b in zip(c0, c1))
    return stops[-1][1]
