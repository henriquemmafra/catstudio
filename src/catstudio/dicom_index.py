"""Indexação DICOM só pelos cabeçalhos e catálogo de estudos → séries → pilhas.

O catálogo é a parte do CatStudio que decide O QUE pode ser carregado; quem lê e monta o
volume é o 3D Slicer (vtkITK, GDCM com fallback DCMTK, via trame-slicer). Separar as duas
coisas permite listar as séries rapidamente, dividir séries heterogêneas e explicar ao
usuário por que uma série não serve para reconstrução, sem tocar no núcleo do Slicer.

Privacidade: só as tags listadas em HEADER_TAGS são lidas. Nome, ID, data de nascimento e
demais dados do paciente nunca são carregados na memória do CatStudio.
"""

from __future__ import annotations

import logging
import os
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

import numpy as np
import pydicom
from pydicom.errors import InvalidDicomError

from . import geometry

log = logging.getLogger("catstudio.dicom")

HEADER_TAGS = [
    "SpecificCharacterSet", "SOPClassUID", "SOPInstanceUID", "StudyInstanceUID", "SeriesInstanceUID",
    "SeriesNumber", "SeriesDescription", "StudyDescription", "StudyDate", "Modality", "ImageType",
    "Rows", "Columns", "BitsAllocated", "SamplesPerPixel", "PhotometricInterpretation", "NumberOfFrames",
    "ImagePositionPatient", "ImageOrientationPatient", "PixelSpacing", "SliceThickness", "AcquisitionNumber",
    "TemporalPositionIdentifier", "WindowCenter", "WindowWidth", "KVP", "ConvolutionKernel", "BodyPartExamined",
    "ContrastBolusAgent", "LossyImageCompression", "Manufacturer",
    "PixelData", "FloatPixelData", "DoubleFloatPixelData",
]
SKIP_EXT = {".txt", ".xml", ".json", ".pdf", ".htm", ".html", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".exe",
            ".dll", ".ini", ".inf", ".js", ".css", ".md", ".csv", ".log", ".db", ".sqlite", ".lnk", ".url"}
LOSSY_TS = {"1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51", "1.2.840.10008.1.2.4.81",
            "1.2.840.10008.1.2.4.91", "1.2.840.10008.1.2.4.203"}
PIXEL_TAGS = (0x7FE00010, 0x7FE00008, 0x7FE00009)
SKIP_REASONS = {
    "extensao": "extensão que não é DICOM",
    "nao_dicom": "não é DICOM",
    "sem_imagem": "DICOM sem imagem (relatório, DICOMDIR etc.)",
    "truncado": "arquivo truncado ou corrompido",
    "repetido": "cópia repetida da mesma imagem",
}


@dataclass
class Instance:
    path: str
    sop_uid: str
    study_uid: str
    series_uid: str
    series_number: int | None
    series_desc: str
    study_desc: str
    study_date: str
    modality: str
    image_type: tuple[str, ...]
    rows: int
    cols: int
    frames: int
    ipp: np.ndarray | None
    iop: np.ndarray | None
    spacing: tuple[float, float] | None
    thickness: float | None
    acq: str
    temporal: str
    spp: int
    photometric: str
    ts: str
    sop_class: str
    window: tuple[float, float] | None
    kvp: str
    kernel: str
    body_part: str
    contrast: str
    lossy: bool


@dataclass
class Stack:
    id: str
    study_uid: str
    series_uid: str
    label: str
    instances: list[Instance]
    status: str = "ok"              # ok | aviso | erro
    messages: list[str] = field(default_factory=list)
    needs_confirmation: bool = False
    geometry: geometry.StackGeometry | None = None

    @property
    def files(self) -> list[str]:
        return [i.path for i in self.instances]

    @property
    def first(self) -> Instance:
        return self.instances[0]

    def summary(self) -> dict:
        i, g = self.first, self.geometry
        out = {"id": self.id, "label": self.label, "status": self.status, "messages": self.messages,
               "n": len(self.instances), "confirm": self.needs_confirmation,
               "dims": f"{i.cols}×{i.rows}" + (f"×{g.n}" if g else ""),
               "spacing": "", "plane": g.plane if g else "", "extent": ""}
        if g:
            fm = geometry.fmt_mm
            out["spacing"] = f"{fm(g.col_spacing, 3)} × {fm(g.row_spacing, 3)} × {fm(g.median_spacing, 3)} mm"
            ex = g.extent_mm
            out["extent"] = f"{fm(ex[0], 0)} × {fm(ex[1], 0)} × {fm(ex[2], 0)} mm"
        return out


@dataclass
class Series:
    uid: str
    study_uid: str
    number: int | None
    description: str
    modality: str
    stacks: list[Stack] = field(default_factory=list)

    @property
    def n(self) -> int:
        return sum(len(s.instances) for s in self.stacks)


@dataclass
class Study:
    uid: str
    description: str
    date: str
    series: list[Series] = field(default_factory=list)


@dataclass
class Catalog:
    studies: list[Study] = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)
    n_files: int = 0

    def stacks(self) -> Iterable[Stack]:
        for st in self.studies:
            for se in st.series:
                yield from se.stacks

    def stack(self, stack_id: str) -> Stack | None:
        return next((s for s in self.stacks() if s.id == stack_id), None)

    def best_stack(self) -> Stack | None:
        """A maior pilha sem erro — sugestão inicial, nunca carregada sem o usuário ver a lista."""
        ok = [s for s in self.stacks() if s.status != "erro"]
        return max(ok, key=lambda s: len(s.instances), default=None)

    def skipped_text(self) -> str:
        parts = [f"{n} {SKIP_REASONS.get(k, k)}" for k, n in self.skipped.most_common() if n]
        return "; ".join(parts)


# ----------------------------------------------------------------------------------- leitura
def _num_list(v) -> list[float] | None:
    if v is None:
        return None
    try:
        seq = list(v) if isinstance(v, (list, tuple, pydicom.multival.MultiValue)) else [v]
        return [float(x) for x in seq]
    except (TypeError, ValueError):
        return None


def _first_float(v) -> float | None:
    vals = _num_list(v)
    return vals[0] if vals else None


def _str(ds, name: str) -> str:
    v = ds.get(name)
    if v is None:
        return ""
    return str(v).strip()


def read_header(path: str) -> tuple[Instance | None, str | None]:
    """Lê só os cabeçalhos necessários. Retorna (instância, None) ou (None, motivo)."""
    try:
        size = os.path.getsize(path)
        ds = pydicom.dcmread(path, force=True, specific_tags=HEADER_TAGS, defer_size=1024)
    except (InvalidDicomError, OSError, ValueError, EOFError, KeyError, TypeError, AttributeError):
        return None, "nao_dicom"
    except Exception:  # noqa: BLE001 — qualquer outro erro do parser = arquivo inválido
        return None, "nao_dicom"
    meta = getattr(ds, "file_meta", None)
    sop_class = _str(ds, "SOPClassUID") or (_str(meta, "MediaStorageSOPClassUID") if meta else "")
    if not sop_class or not _str(ds, "SeriesInstanceUID"):
        return None, "nao_dicom"
    pixel = None
    for tag in PIXEL_TAGS:
        try:
            pixel = ds.get_item(tag)
        except Exception:  # noqa: BLE001
            pixel = None
        if pixel is not None:
            break
    if pixel is None or not ds.get("Rows") or not ds.get("Columns"):
        return None, "sem_imagem"
    length = getattr(pixel, "length", None)
    tell = getattr(pixel, "value_tell", None)
    if length not in (None, 0xFFFFFFFF) and tell is not None and tell + length > size:
        return None, "truncado"
    ts = _str(meta, "TransferSyntaxUID") if meta else ""
    ipp = _num_list(ds.get("ImagePositionPatient"))
    iop = _num_list(ds.get("ImageOrientationPatient"))
    sp = _num_list(ds.get("PixelSpacing"))
    wc, ww = _first_float(ds.get("WindowCenter")), _first_float(ds.get("WindowWidth"))
    try:
        frames = int(ds.get("NumberOfFrames") or 1)
    except (TypeError, ValueError):
        frames = 1
    try:
        number = int(ds.get("SeriesNumber")) if ds.get("SeriesNumber") is not None else None
    except (TypeError, ValueError):
        number = None
    it = ds.get("ImageType")
    image_type = tuple(str(x).upper() for x in it) if isinstance(it, (list, pydicom.multival.MultiValue)) else \
        ((str(it).upper(),) if it else ())
    inst = Instance(
        path=path, sop_uid=_str(ds, "SOPInstanceUID"), study_uid=_str(ds, "StudyInstanceUID") or "sem-estudo",
        series_uid=_str(ds, "SeriesInstanceUID"), series_number=number,
        series_desc=_str(ds, "SeriesDescription"), study_desc=_str(ds, "StudyDescription"),
        study_date=_str(ds, "StudyDate"), modality=_str(ds, "Modality").upper(), image_type=image_type,
        rows=int(ds.Rows), cols=int(ds.Columns), frames=frames,
        ipp=np.array(ipp) if ipp and len(ipp) == 3 else None,
        iop=np.array(iop) if iop and len(iop) == 6 else None,
        spacing=(sp[0], sp[1]) if sp and len(sp) >= 2 and sp[0] > 0 and sp[1] > 0 else None,
        thickness=_first_float(ds.get("SliceThickness")), acq=_str(ds, "AcquisitionNumber"),
        temporal=_str(ds, "TemporalPositionIdentifier"), spp=int(ds.get("SamplesPerPixel") or 1),
        photometric=_str(ds, "PhotometricInterpretation").upper(), ts=ts, sop_class=sop_class,
        window=(wc, ww) if wc is not None and ww and ww > 0 else None, kvp=_str(ds, "KVP"),
        kernel=_str(ds, "ConvolutionKernel"), body_part=_str(ds, "BodyPartExamined"),
        contrast=_str(ds, "ContrastBolusAgent"),
        lossy=(ts in LOSSY_TS) or _str(ds, "LossyImageCompression") == "01",
    )
    return inst, None


def list_files(root: str) -> tuple[list[str], int]:
    """Todos os arquivos candidatos sob `root` (sem ocultos e sem extensões que não são DICOM)."""
    out, skipped = [], 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "__MACOSX"]
        for f in filenames:
            if f.startswith("."):
                continue
            p = os.path.join(dirpath, f)
            ext = os.path.splitext(f)[1].lower()
            if ext in SKIP_EXT:
                skipped += 1
                continue
            try:
                if os.path.getsize(p) < 128:
                    skipped += 1
                    continue
            except OSError:
                continue
            out.append(p)
    return sorted(out), skipped


# ----------------------------------------------------------------------------------- catálogo
def build_catalog(paths: list[str], progress: Callable[[float], None] | None = None,
                  pre_skipped: int = 0) -> Catalog:
    cat = Catalog(n_files=len(paths) + pre_skipped)
    if pre_skipped:
        cat.skipped["extensao"] += pre_skipped
    by_series: dict[tuple[str, str], list[Instance]] = defaultdict(list)
    seen_sop: set[str] = set()
    for k, p in enumerate(paths):
        inst, reason = read_header(p)
        if inst is None:
            cat.skipped[reason] += 1
        elif inst.sop_uid and inst.sop_uid in seen_sop:
            cat.skipped["repetido"] += 1
        else:
            if inst.sop_uid:
                seen_sop.add(inst.sop_uid)
            by_series[(inst.study_uid, inst.series_uid)].append(inst)
        if progress and (k % 25 == 0 or k == len(paths) - 1):
            progress((k + 1) / max(1, len(paths)))

    studies: dict[str, Study] = {}
    counter = [0]

    def new_id() -> str:
        counter[0] += 1
        return f"P{counter[0]}"

    for (study_uid, series_uid), insts in by_series.items():
        f = insts[0]
        st = studies.get(study_uid)
        if st is None:
            st = studies[study_uid] = Study(uid=study_uid, description=f.study_desc or "Estudo sem descrição",
                                            date=f.study_date)
        se = Series(uid=series_uid, study_uid=study_uid, number=f.series_number,
                    description=f.series_desc or "Série sem descrição", modality=f.modality or "?")
        se.stacks = _split_series(insts, new_id)
        st.series.append(se)
    for st in studies.values():
        st.series.sort(key=lambda s: (s.number is None, s.number or 0, s.description))
    cat.studies = sorted(studies.values(), key=lambda s: s.date, reverse=True)
    return cat


def _key(i: Instance) -> tuple:
    iop = tuple(np.round(i.iop, 3)) if i.iop is not None else None
    sp = tuple(np.round(i.spacing, 4)) if i.spacing else None
    return (i.rows, i.cols, iop, sp)


def _split_series(insts: list[Instance], new_id: Callable[[], str]) -> list[Stack]:
    """Divide uma série em pilhas homogêneas e dá a cada uma um veredito geométrico."""
    stacks: list[Stack] = []
    f = insts[0]

    def make(label, members, status="ok", msgs=None):
        s = Stack(id=new_id(), study_uid=f.study_uid, series_uid=f.series_uid, label=label, instances=members,
                  status=status, messages=list(msgs or []))
        stacks.append(s)
        return s

    rest = []
    for i in insts:
        if i.frames > 1:
            make("Multi-frame", [i], "erro", [
                f"Objeto multi-frame ({i.frames} quadros, p. ex. Enhanced CT): o leitor do Slicer usado aqui não "
                "aplica a geometria por quadro. Exporte a série como imagens individuais (classic)."])
        else:
            rest.append(i)
    locs = [i for i in rest if "LOCALIZER" in i.image_type]
    if locs:
        make("Topograma / localizador", locs, "erro",
             ["Imagem de planejamento (localizador): projeção, não um volume tomográfico."])
    rest = [i for i in rest if "LOCALIZER" not in i.image_type]
    color = [i for i in rest if i.spp != 1 or not i.photometric.startswith("MONOCHROME")]
    if color:
        make("Imagens coloridas/capturas", color, "erro",
             ["Imagens coloridas ou capturas de tela (secondary capture) não formam um volume em HU."])
    rest = [i for i in rest if i.spp == 1 and i.photometric.startswith("MONOCHROME")]
    nogeo = [i for i in rest if i.ipp is None or i.iop is None or i.spacing is None]
    if nogeo:
        make("Sem geometria", nogeo, "erro",
             ["Faltam posição/orientação/espaçamento do pixel (IPP, IOP ou PixelSpacing): proporções e posição "
              "anatômica seriam desconhecidas."])
    rest = [i for i in rest if not (i.ipp is None or i.iop is None or i.spacing is None)]
    if not rest:
        return stacks

    groups: dict[tuple, list[Instance]] = defaultdict(list)
    for i in rest:
        groups[_key(i)].append(i)
    multi = len(groups) > 1
    for gi, members in enumerate(sorted(groups.values(), key=len, reverse=True), start=1):
        base = f"Parte {gi} ({members[0].cols}×{members[0].rows})" if multi else "Volume"
        pre = (["Série com geometrias diferentes (matriz, orientação ou pixel): dividida em partes que não se "
                "misturam."] if multi else [])
        for label, sub, extra in _split_duplicates(base, members):
            s = make(label, sub, msgs=pre + extra)
            _judge(s)
    return stacks


def _split_duplicates(label: str, members: list[Instance]):
    """Se houver posições repetidas, tenta separar por aquisição ou posição temporal (fases)."""
    g = geometry.analyze([m.ipp for m in members], members[0].iop, members[0].spacing,
                         members[0].rows, members[0].cols)
    if g.duplicates == 0:
        return [(label, members, [])]
    for attr, name in (("acq", "Aquisição"), ("temporal", "Fase temporal")):
        parts: dict[str, list[Instance]] = defaultdict(list)
        for m in members:
            parts[getattr(m, attr)].append(m)
        if len(parts) < 2:
            continue
        ok = all(
            geometry.analyze([m.ipp for m in p], p[0].iop, p[0].spacing, p[0].rows, p[0].cols).duplicates == 0
            for p in parts.values()
        )
        if ok:
            msg = (f"Posições repetidas resolvidas separando por {name.lower()}: cada parte é carregada "
                   "isoladamente, sem misturar fases.")
            return [(f"{label} · {name} {k or '?'}", p, [msg])
                    for k, p in sorted(parts.items(), key=lambda kv: -len(kv[1]))]
    return [(label, members, [])]


def _judge(s: Stack) -> None:
    f = s.first
    try:
        g = geometry.analyze([i.ipp for i in s.instances], f.iop, f.spacing, f.rows, f.cols)
    except ValueError as e:
        s.status, s.messages = "erro", [*s.messages, str(e)]
        return
    s.instances = [s.instances[k] for k in g.order]
    s.geometry = g
    status, msgs, confirm = geometry.verdict(g)
    s.messages = [*s.messages, *msgs]
    s.needs_confirmation = confirm
    rank = {"ok": 0, "aviso": 1, "erro": 2}
    s.status = max(s.status, status, key=rank.get)
    if s.status != "erro":
        if f.modality and f.modality != "CT":
            s.status = max(s.status, "aviso", key=rank.get)
            s.messages.append(f"Modalidade {f.modality}: os presets em unidades Hounsfield foram pensados para TC.")
        if any(i.lossy for i in s.instances):
            s.messages.append("Imagens com compressão com perdas: detalhes finos podem estar alterados.")
