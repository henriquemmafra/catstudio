"""Ajustes das vistas 2D do Slicer para MPR nos planos anatômicos verdadeiros.

Por padrão, ao exibir um volume, o Slicer gira as vistas para o plano de aquisição
(vtkMRMLApplicationLogic::FitSliceToContent → RotateSliceToLowestVolumeAxes). Com aquisição
oblíqua isso deixa o "axial" oblíquo; com gantry tilt (matriz IJK→RAS cisalhada) a rotação
gera uma matriz de corte não ortonormal e distorce a vista sagital. O CatStudio recoloca as
três vistas nos planos do paciente — axial, coronal e sagital verdadeiros —, que é o que se
espera numa estação de MPR, e o fatiamento continua sendo feito pelo Slicer com a matriz
completa do volume.
"""

from __future__ import annotations

ORIENTATION = {"Red": "Axial", "Green": "Coronal", "Yellow": "Sagittal"}


def standard_planes(slice_views, center_ras=None) -> None:
    for v in slice_views:
        node = v.get_view_node()
        tag = v.get_singleton_tag()
        if node is None or tag not in ORIENTATION:
            continue
        node.SetOrientation(ORIENTATION[tag])
        v.fit_view_to_content()
        if center_ras is not None:
            node.JumpSliceByCentering(*center_ras)
