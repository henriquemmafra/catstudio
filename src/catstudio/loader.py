"""Carregamento de uma pilha DICOM pelo leitor do 3D Slicer e conferência da geometria.

Quem lê e monta o volume é o Slicer: trame_slicer.core.VolumesReader, adaptação do
DICOMScalarVolumePlugin, usando vtkITKArchetypeImageSeriesScalarReader com GDCM e fallback
DCMTK, conversão para RAS e regularização de geometria irregular. O CatStudio só entrega a
lista de arquivos já separada e ordenada, e depois confere o resultado contra a análise
independente dos cabeçalhos (geometry.py).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
from vtkmodules.util.numpy_support import vtk_to_numpy
from vtkmodules.vtkCommonMath import vtkMatrix4x4

from . import geometry
from .dicom_index import Stack

log = logging.getLogger("catstudio.loader")


@dataclass
class LoadResult:
    volume_node: object
    dims: tuple[int, int, int]
    spacing: tuple[float, float, float]
    ijk_to_ras: np.ndarray
    hu_range: tuple[float, float]
    regularized: bool
    check_mm: float | None
    messages: list[str] = field(default_factory=list)


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.records: list[str] = []

    def emit(self, record):
        self.records.append(record.getMessage())


def matrix(volume_node) -> np.ndarray:
    m = vtkMatrix4x4()
    volume_node.GetIJKToRASMatrix(m)
    return np.array([[m.GetElement(i, j) for j in range(4)] for i in range(4)])


def load_stack(slicer_app, stack: Stack) -> LoadResult:
    from trame_slicer.core.volumes_reader import VolumesReader

    cap = _Capture()
    root = logging.getLogger()
    root.addHandler(cap)
    try:
        nodes = VolumesReader.load_volumes(slicer_app.scene, slicer_app.app_logic, stack.files)
    finally:
        root.removeHandler(cap)
    if not nodes:
        msg = "O leitor DICOM do Slicer não conseguiu montar esta série."
        raise RuntimeError(msg)
    if len(nodes) > 1:
        # a pilha já chega homogênea; se o leitor ainda dividir, fica a maior e as demais saem da cena
        nodes.sort(key=lambda n: np.prod(n.GetImageData().GetDimensions()))
        for extra in nodes[:-1]:
            slicer_app.scene.RemoveNode(extra)
    node = nodes[-1]
    img = node.GetImageData()
    dims = img.GetDimensions()
    M = matrix(node)
    regularized = any("Irregular" in r for r in cap.records)
    msgs = []
    if regularized:
        msgs.append("Geometria irregular regularizada pelo Slicer (reamostragem nas posições reais dos cortes).")
    check = None
    if stack.geometry is not None:
        check = geometry.ijk_to_ras_check(M, dims, stack.geometry)
        if check > 0.5:
            msgs.append(f"Atenção: a matriz do volume difere {geometry.fmt_mm(check)} mm das posições dos cabeçalhos.")
    arr = vtk_to_numpy(img.GetPointData().GetScalars())
    lo, hi = float(arr.min()), float(arr.max())
    return LoadResult(node, dims, tuple(node.GetSpacing()), M, (lo, hi), regularized, check, msgs)


class VolumeSampler:
    """Amostra o valor (HU) de um volume num ponto RAS — usado pela sonda do cursor."""

    def __init__(self, volume_node):
        img = volume_node.GetImageData()
        self.dims = img.GetDimensions()
        self.array = vtk_to_numpy(img.GetPointData().GetScalars()).reshape(self.dims[2], self.dims[1], self.dims[0])
        m = vtkMatrix4x4()
        volume_node.GetRASToIJKMatrix(m)
        self.ras_to_ijk = np.array([[m.GetElement(i, j) for j in range(4)] for i in range(4)])

    def __call__(self, ras) -> float | None:
        ijk = self.ras_to_ijk @ np.array([ras[0], ras[1], ras[2], 1.0])
        i, j, k = (int(round(v)) for v in ijk[:3])
        nx, ny, nz = self.dims
        if 0 <= i < nx and 0 <= j < ny and 0 <= k < nz:
            return float(self.array[k, j, i])
        return None
