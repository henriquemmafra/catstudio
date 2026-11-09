"""Entrada de arquivos: upload pelo navegador (em blocos) e arquivos .zip.

Os arquivos recebidos são gravados numa pasta temporária da sessão com nomes neutros
(000001, 000002…): o nome original — que em exportações de CD às vezes contém o nome do
paciente — nunca é usado em disco nem aparece em mensagens de log.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile

SAFE_EXT = re.compile(r"^\.[A-Za-z0-9]{1,5}$")


class Session:
    def __init__(self, base: str | None = None):
        self.root = tempfile.mkdtemp(prefix="catstudio-", dir=base)
        self.counter = 0
        self.batch = None

    def new_batch(self) -> str:
        self.batch = tempfile.mkdtemp(prefix="exame-", dir=self.root)
        self.counter = 0
        return self.batch

    def write(self, name: str, content: bytes) -> str:
        if self.batch is None:
            self.new_batch()
        self.counter += 1
        ext = os.path.splitext(name or "")[1]
        ext = ext.lower() if SAFE_EXT.match(ext or "") else ""
        path = os.path.join(self.batch, f"{self.counter:06d}{ext}")
        with open(path, "wb") as f:
            f.write(content)
        return path

    def expand_zips(self) -> int:
        """Extrai os .zip do lote atual (sem preservar caminhos internos) e os apaga. Retorna nº extraído."""
        if not self.batch:
            return 0
        n = 0
        for f in sorted(os.listdir(self.batch)):
            p = os.path.join(self.batch, f)
            if not f.endswith(".zip") or not zipfile.is_zipfile(p):
                continue
            stem = os.path.splitext(f)[0]
            with zipfile.ZipFile(p) as z:
                for k, info in enumerate(z.infolist()):
                    base = os.path.basename(info.filename)
                    if info.is_dir() or not base or base.startswith(".") or "__MACOSX" in info.filename:
                        continue
                    ext = os.path.splitext(base)[1]
                    ext = ext.lower() if SAFE_EXT.match(ext or "") else ""
                    dst = os.path.join(self.batch, f"{stem}_{k:06d}{ext}")
                    with z.open(info) as src, open(dst, "wb") as out:
                        shutil.copyfileobj(src, out, 1 << 20)
                    n += 1
            os.remove(p)
        return n

    def clear_old_batches(self, keep: str | None = None) -> None:
        for d in os.listdir(self.root):
            p = os.path.join(self.root, d)
            if p != keep:
                shutil.rmtree(p, ignore_errors=True)

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
