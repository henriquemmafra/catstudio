"""Gera docs/LICENCAS_DEPENDENCIAS.md a partir dos metadados dos pacotes instalados no ambiente.

Uso:  python scripts/licencas.py      (no ambiente virtual do CatStudio)
"""

from __future__ import annotations

import importlib.metadata as md
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP = {"catstudio", "pip", "setuptools", "wheel", "pytest", "pluggy", "iniconfig", "pygments", "playwright",
        "greenlet", "pyee", "typing-extensions", "typing_extensions"}


def license_of(dist) -> str:
    m = dist.metadata
    expr = m.get("License-Expression")
    if expr:
        return expr
    lic = (m.get("License") or "").strip()
    if lic and len(lic) < 80 and "\n" not in lic:
        return lic
    classifiers = [c.split("::")[-1].strip() for c in m.get_all("Classifier") or [] if c.startswith("License ::")]
    if classifiers:
        return "; ".join(dict.fromkeys(classifiers))
    return (lic.splitlines()[0][:80] + "…") if lic else "não declarada no pacote"


def main():
    rows = []
    for dist in md.distributions():
        name = dist.metadata["Name"]
        if not name or name.lower() in SKIP:
            continue
        url = dist.metadata.get("Home-page") or ""
        for u in dist.metadata.get_all("Project-URL") or []:
            if re.search(r"source|repository|homepage", u, re.I):
                url = u.split(",", 1)[-1].strip()
                break
        rows.append((name.lower(), name, dist.version, license_of(dist), url))
    rows.sort()
    out = ["# Licenças das dependências Python instaladas", "",
           "Gerado por `scripts/licencas.py` a partir dos metadados dos pacotes (campo License / Classifier).",
           "Veja `LICENCAS.md` para a análise, inclusive das bibliotecas nativas embutidas no `slicer-core`.", "",
           "| Pacote | Versão | Licença declarada | Fonte |", "|---|---|---|---|"]
    out += [f"| {n} | {v} | {lic} | {u} |" for _, n, v, lic, u in rows]
    path = os.path.join(ROOT, "docs", "LICENCAS_DEPENDENCIAS.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(path, len(rows), "pacotes")


if __name__ == "__main__":
    main()
