"""Linha de comando: `catstudio` ou `python -m catstudio`.

Por padrão o servidor escuta só em 127.0.0.1 (este computador) e abre o navegador.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys


def main(argv=None):
    p = argparse.ArgumentParser(prog="catstudio", description="CatStudio — estúdio web de TC sobre o 3D Slicer")
    p.add_argument("--port", type=int, default=8765, help="porta HTTP (padrão 8765)")
    p.add_argument("--host", default="127.0.0.1",
                   help="interface de rede (padrão 127.0.0.1: só este computador acessa)")
    p.add_argument("--no-browser", action="store_true", help="não abrir o navegador automaticamente")
    p.add_argument("--open", metavar="PASTA", help="importar esta pasta DICOM ao iniciar")
    p.add_argument("--verbose", action="store_true", help="mensagens de diagnóstico no terminal")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    if args.open and not os.path.isdir(args.open):
        print(f"Pasta não encontrada: {args.open}", file=sys.stderr)
        return 2
    local = args.host in ("127.0.0.1", "localhost", "::1")
    if not local:
        print("Aviso: CatStudio acessível pela rede. Exames enviados passam por esta máquina; "
              "use só em rede confiável.", file=sys.stderr)

    from .app import CatStudioApp

    app = CatStudioApp(local_mode=local, initial_folder=args.open)
    print(f"CatStudio em http://{'127.0.0.1' if local else args.host}:{args.port}/  (Ctrl+C para encerrar)")
    app.server.start(port=args.port, host=args.host, open_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
