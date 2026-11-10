"""Gera um "exame completo" sintético (várias séries 512×512, ~2000 imagens,
~1 GB) para testar o consumo de memória ao abrir a pasta inteira de um exame.

    python3 make_exame_grande.py [pasta_saida]     (padrão: .data/exame_grande)
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from make_fixtures import axial, new_study, stack, write_series  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, ".data", "exame_grande")


def main():
    os.makedirs(OUT, exist_ok=True)
    study = new_study("Exame completo sintético")
    N, S = 512, 0.75
    thin = np.arange(-199.5, 200.0, 1.0)            # 400 cortes de 1 mm
    thick = np.arange(-197.5, 200.0, 5.0)           # 80 cortes de 5 mm
    series = [
        ("Tórax 5 mm", axial(N, N, S, S, thick), 5.0, 0),
        ("Tórax 1 mm partes moles", axial(N, N, S, S, thin), 1.0, 0),
        ("Tórax 1 mm pulmão", axial(N, N, S, S, thin), 1.0, 0),
        ("Fase arterial 1 mm", axial(N, N, S, S, thin), 1.0, 30),
        ("Fase venosa 1 mm", axial(N, N, S, S, thin), 1.0, 15),
        ("MPR coronal 2 mm", stack((0, 0, 0), (1, 0, 0), (0, 0, -1), (0, 1, 0), N, N, S, S,
                                   np.arange(-149.0, 150.0, 2.0)), 2.0, 0),
        ("MPR sagital 2 mm", stack((0, 0, 0), (0, 1, 0), (0, 0, -1), (-1, 0, 0), N, N, S, S,
                                   np.arange(-149.0, 150.0, 2.0)), 2.0, 0),
    ]
    total = 0
    for n, (desc, geom, thickness, offset) in enumerate(series, start=2):
        folder = os.path.join(OUT, f"S{n:03d}")
        os.makedirs(folder, exist_ok=True)
        write_series(folder, study, geom, N, N, S, S, thickness, signed=True, desc=desc,
                     series_number=n, hu_offset=offset)
        total += len(geom)
        print(f"{desc}: {len(geom)} imagens")
    print(f"total: {total} imagens em {OUT}")


if __name__ == "__main__":
    main()
