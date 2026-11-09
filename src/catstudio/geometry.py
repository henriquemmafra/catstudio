"""Análise geométrica de uma pilha de cortes DICOM, feita só com os cabeçalhos.

Serve para o CatStudio avisar o usuário ANTES de carregar (lacunas, espaçamento irregular,
gantry tilt, duplicados) e para conferir, DEPOIS de carregar, se a matriz IJK→RAS que o
leitor do 3D Slicer produziu bate com as posições declaradas nos arquivos.

Convenções: DICOM usa LPS (+x esquerda, +y posterior, +z superior); o Slicer usa RAS
(+x direita, +y anterior, +z superior). RAS = LPS × (−1, −1, +1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

LPS_TO_RAS = np.array([-1.0, -1.0, 1.0])

# tolerâncias (mm)
DUPLICATE_MM = 0.01          # duas imagens nesta distância ocupam a mesma posição
UNIFORM_ABS_MM = 0.01        # variação aceita entre espaçamentos ...
UNIFORM_REL = 0.02           # ... ou 2% do espaçamento mediano (o que for maior)
GAP_FACTOR = 1.5             # salto > 1,5 × mediana = corte(s) ausente(s)
TILT_MIN_DEG = 0.1           # abaixo disso não vale a pena falar em inclinação
COLLINEAR_MM = 0.05          # quanto a posição de um corte pode fugir da reta dos demais


@dataclass
class StackGeometry:
    n: int
    rows: int
    cols: int
    row_spacing: float                 # PixelSpacing[0]: distância entre linhas (ao longo de col_dir)
    col_spacing: float                 # PixelSpacing[1]: distância entre colunas (ao longo de row_dir)
    row_dir: np.ndarray                # IOP[0:3] — direção de crescimento do índice de coluna
    col_dir: np.ndarray                # IOP[3:6] — direção de crescimento do índice de linha
    normal: np.ndarray
    order: list[int]                   # índices das imagens em ordem espacial
    positions: np.ndarray              # IPP ordenadas (n×3, LPS)
    distances: np.ndarray              # projeção na normal (mm), crescente
    gaps: np.ndarray                   # n-1 distâncias entre cortes vizinhos
    median_spacing: float
    min_spacing: float
    max_spacing: float
    uniform: bool
    missing: list[tuple[float, float, float]] = field(default_factory=list)   # (de, até, tamanho) em mm
    duplicates: int = 0
    tilt_deg: float = 0.0
    collinear: bool = True
    max_offline_mm: float = 0.0
    plane: str = "oblíquo"

    @property
    def extent_mm(self) -> tuple[float, float, float]:
        return (self.cols * self.col_spacing, self.rows * self.row_spacing,
                float(self.distances[-1] - self.distances[0]) if self.n > 1 else 0.0)


def acquisition_plane(normal: np.ndarray) -> str:
    """Nome do plano de aquisição pela normal (em LPS)."""
    a = np.abs(normal)
    k = int(np.argmax(a))
    if a[k] < math.cos(math.radians(20)):
        return "oblíquo"
    return ("sagital", "coronal", "axial")[k]


def analyze(ipps: list, iop, pixel_spacing, rows: int, cols: int) -> StackGeometry:
    """Ordena pelas posições (projeção na normal, nunca pelo nome do arquivo) e mede a pilha."""
    iop = np.asarray(iop, float)
    r, c = iop[:3], iop[3:6]
    r = r / np.linalg.norm(r)
    c = c / np.linalg.norm(c)
    if abs(float(np.dot(r, c))) > 1e-3:
        raise ValueError("ImageOrientationPatient inválida: as direções de linha e coluna não são ortogonais.")
    n_vec = np.cross(r, c)
    P = np.asarray(ipps, float).reshape(-1, 3)
    d = P @ n_vec
    order = list(np.argsort(d, kind="stable"))
    P, d = P[order], d[order]
    gaps = np.diff(d)
    dup = int(np.sum(gaps < DUPLICATE_MM))
    real = gaps[gaps >= DUPLICATE_MM]
    med = float(np.median(real)) if real.size else 0.0
    tol = max(UNIFORM_ABS_MM, UNIFORM_REL * med)
    uniform = bool(real.size == 0 or np.all(np.abs(real - med) <= tol))
    missing = []
    if med > 0:
        for i, g in enumerate(gaps):
            if g > GAP_FACTOR * med:
                missing.append((float(d[i]), float(d[i + 1]), float(g)))
    # deslocamento no plano ao longo da pilha (gantry tilt) e colinearidade
    tilt = 0.0
    collinear = True
    max_off = 0.0
    if len(P) >= 2 and d[-1] - d[0] > DUPLICATE_MM:
        span = d[-1] - d[0]
        shear = (P[-1] - P[0]) - span * n_vec          # componente no plano, total
        sigma = shear / span                             # por mm ao longo da normal
        tilt = math.degrees(math.atan(float(np.linalg.norm(sigma))))
        expected = P[0] + np.outer(d - d[0], n_vec + sigma)
        max_off = float(np.max(np.linalg.norm(P - expected, axis=1)))
        collinear = max_off <= max(COLLINEAR_MM, 0.05 * min(pixel_spacing))
    return StackGeometry(
        n=len(P), rows=int(rows), cols=int(cols),
        row_spacing=float(pixel_spacing[0]), col_spacing=float(pixel_spacing[1]),
        row_dir=r, col_dir=c, normal=n_vec, order=order, positions=P, distances=d, gaps=gaps,
        median_spacing=med, min_spacing=float(real.min()) if real.size else 0.0,
        max_spacing=float(real.max()) if real.size else 0.0, uniform=uniform, missing=missing,
        duplicates=dup, tilt_deg=tilt if tilt >= TILT_MIN_DEG else 0.0, collinear=collinear,
        max_offline_mm=max_off, plane=acquisition_plane(n_vec),
    )


def fmt_mm(v: float, nd: int = 2) -> str:
    s = f"{v:.{nd}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s.replace(".", ",")


def verdict(g: StackGeometry) -> tuple[str, list[str], bool]:
    """(status, mensagens, exige_confirmação). status ∈ {'ok','aviso','erro'}."""
    msgs: list[str] = []
    status = "ok"
    confirm = False
    if g.n < 3:
        return "erro", [f"Apenas {g.n} imagem(ns) nesta pilha: não há volume para reconstruir."], False
    if g.duplicates:
        return "erro", [f"{g.duplicates} posição(ões) com mais de uma imagem diferente: a pilha mistura volumes "
                        "e montá-la produziria geometria incorreta."], False
    if not g.collinear:
        return "erro", [f"As posições dos cortes não estão alinhadas (desvio de até {fmt_mm(g.max_offline_mm)} mm): "
                        "geometria inconsistente para reconstrução volumétrica."], False
    if g.n < 20:
        status = "aviso"
        msgs.append(f"Só {g.n} cortes: cobertura curta para MPR e 3D.")
    if g.tilt_deg:
        msgs.append(f"Gantry inclinado {fmt_mm(g.tilt_deg, 1)}°: o Slicer preserva a inclinação real na matriz do volume.")
    if g.missing:
        status = "aviso"
        confirm = True
        biggest = max(g.missing, key=lambda m: m[2])
        msgs.append(f"{len(g.missing)} lacuna(s) entre cortes (maior: {fmt_mm(biggest[2])} mm, de "
                    f"{fmt_mm(biggest[0], 1)} a {fmt_mm(biggest[1], 1)} mm ao longo da pilha). "
                    "O conteúdo nessas faixas será interpolado, não medido.")
    elif not g.uniform:
        status = "aviso"
        msgs.append(f"Espaçamento irregular ({fmt_mm(g.min_spacing)}–{fmt_mm(g.max_spacing)} mm): "
                    "o Slicer regulariza a grade por interpolação entre os cortes reais.")
    return status, msgs, confirm


def ijk_to_ras_check(ijk_to_ras: np.ndarray, dims: tuple[int, int, int], g: StackGeometry) -> float:
    """Maior distância (mm) entre os cantos do 1º/último corte do volume carregado e as posições
    declaradas nos cabeçalhos. Confere o leitor do Slicer contra a análise independente."""
    nx, ny, nz = dims

    def ras(i, j, k):
        return (ijk_to_ras @ np.array([i, j, k, 1.0]))[:3]

    expected = []
    for P in (g.positions[0], g.positions[-1]):
        for (i, j) in ((0, 0), (g.cols - 1, g.rows - 1)):
            lps = P + i * g.col_spacing * g.row_dir + j * g.row_spacing * g.col_dir
            expected.append(lps * LPS_TO_RAS)
    expected = np.array(expected)
    actual = [ras(i, j, k) for k in (0, nz - 1) for (i, j) in ((0, 0), (nx - 1, ny - 1))]
    return float(max(np.min(np.linalg.norm(expected - a, axis=1)) for a in actual))
