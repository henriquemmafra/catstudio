#!/usr/bin/env python3
"""
CatStudio — gera séries DICOM sintéticas para os testes automatizados.

Tudo é sintético (fantoma analítico em phantom.json): nenhum dado de paciente real.
O nome/ID de paciente gravados são marcadores falsos ("NAO EXIBIR") usados para
verificar que o CatStudio nunca os mostra na interface.

Uso:  python3 make_fixtures.py [pasta_saida]     (padrão: ../.data)
Requer: pydicom>=3, numpy, pylibjpeg, pylibjpeg-openjpeg, pyjpegls, python-gdcm
"""
import json
import math
import os
import random
import shutil
import sys
import zipfile

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import (
    CTImageStorage,
    DeflatedExplicitVRLittleEndian,
    ExplicitVRBigEndian,
    ExplicitVRLittleEndian,
    ImplicitVRLittleEndian,
    JPEG2000Lossless,
    JPEGLSLossless,
    RLELossless,
    generate_uid,
)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", ".data"))
PH = json.load(open(os.path.join(HERE, "phantom.json"), encoding="utf-8"))
RNG = random.Random(20261109)
ENHANCED_CT = "1.2.840.10008.5.1.4.1.1.2.1"
JPEG_LOSSLESS_SV1 = "1.2.840.10008.1.2.4.70"
FAKE_NAME = "NAO^EXIBIR^TESTE"
FAKE_ID = "NAO-EXIBIR-0042"


# ---------------------------------------------------------------- fantoma
def phantom(x, y, z):
    """HU do fantoma em pontos LPS (mm). Mesma fórmula de tests/phantom.js."""
    v = np.full(np.broadcast(x, y, z).shape, float(PH["air"]))
    w = PH["edge_mm"]
    for o in PH["objects"]:
        c = o["center"]
        dx, dy, dz = x - c[0], y - c[1], z - c[2]
        if o["type"] == "ellipsoid":
            a = o["semi"]
            q = np.sqrt((dx / a[0]) ** 2 + (dy / a[1]) ** 2 + (dz / a[2]) ** 2)
            d = (q - 1) * min(a)
        elif o["type"] == "ellipcyl":
            a = o["semi"]
            q = np.sqrt((dx / a[0]) ** 2 + (dy / a[1]) ** 2)
            d = np.maximum((q - 1) * min(a), np.abs(dz) - o["half_height"])
        elif o["type"] == "box":
            h = o["half"]
            d = np.maximum(np.maximum(np.abs(dx) - h[0], np.abs(dy) - h[1]), np.abs(dz) - h[2])
        else:
            raise ValueError(o["type"])
        s = 1.0 / (1.0 + np.exp(np.clip(d / w, -50, 50)))
        v = v + (o["hu"] - v) * s
    return v


# ---------------------------------------------------------------- geometria
def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def stack(center, r, c, stepdir, cols, rows, sx, sy, offsets):
    """lista de (ipp, iop) para cortes com centro em `center` + offset·stepdir"""
    r, c, stepdir, center = unit(r), unit(c), np.asarray(stepdir, float), np.asarray(center, float)
    out = []
    for t in offsets:
        ipp = center - ((cols - 1) / 2) * sx * r - ((rows - 1) / 2) * sy * c + t * stepdir
        out.append((ipp, np.concatenate([r, c])))
    return out


def slice_hu(ipp, iop, cols, rows, sx, sy):
    r, c = iop[:3], iop[3:]
    i = np.arange(cols)[None, :]
    j = np.arange(rows)[:, None]
    x = ipp[0] + i * sx * r[0] + j * sy * c[0]
    y = ipp[1] + i * sx * r[1] + j * sy * c[1]
    z = ipp[2] + i * sx * r[2] + j * sy * c[2]
    return phantom(x, y, z)


# ---------------------------------------------------------------- DICOM
def fmt(v):
    return [f"{float(a):.6f}".rstrip("0").rstrip(".") if abs(a) > 1e-9 else "0" for a in v]


def make_ds(study, series, k, ipp, iop, hu, sx, sy, thick, signed, ts, modality="CT", image_type=None,
            acq=1, sop_uid=None, desc="Série", series_number=1, instance=None, padding=None, wc=40, ww=400):
    rows, cols = hu.shape
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = CTImageStorage
    meta.MediaStorageSOPInstanceUID = sop_uid or generate_uid()
    meta.TransferSyntaxUID = ts
    meta.ImplementationClassUID = generate_uid()
    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.SpecificCharacterSet = "ISO_IR 192"
    ds.PatientName = FAKE_NAME
    ds.PatientID = FAKE_ID
    ds.PatientBirthDate = "19000101"
    ds.StudyInstanceUID = study["uid"]
    ds.StudyDescription = study["desc"]
    ds.StudyDate = study.get("date", "20260101")
    ds.StudyID = "1"
    ds.AccessionNumber = "NAO-EXIBIR"
    ds.InstitutionName = "NAO EXIBIR HOSPITAL"
    ds.SeriesInstanceUID = series
    ds.SeriesDescription = desc
    ds.SeriesNumber = series_number
    ds.FrameOfReferenceUID = study["for"]
    ds.Modality = modality
    ds.Manufacturer = "CatStudio Synthetic"
    ds.ImageType = image_type or ["ORIGINAL", "PRIMARY", "AXIAL"]
    ds.InstanceNumber = instance if instance is not None else k + 1
    ds.AcquisitionNumber = acq
    ds.ImagePositionPatient = fmt(ipp)
    ds.ImageOrientationPatient = fmt(iop)
    ds.PixelSpacing = fmt([sy, sx])
    ds.SliceThickness = fmt([thick])[0]
    ds.KVP = "120"
    ds.ConvolutionKernel = "B30f"
    ds.WindowCenter = str(wc)
    ds.WindowWidth = str(ww)
    ds.Rows, ds.Columns = rows, cols
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.RescaleType = "HU"
    ds.RescaleSlope = "1"
    if signed:
        ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 15, 1
        ds.RescaleIntercept = "0"
        arr = np.round(hu).astype(np.int16)
        if padding is not None:
            ds.PixelPaddingValue = padding
    else:
        ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
        ds.RescaleIntercept = "-1024"
        arr = np.clip(np.round(hu + 1024), 0, 4095).astype(np.uint16)
    return ds, arr


def save(ds, arr, path, ts):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if ts in (ExplicitVRLittleEndian, ImplicitVRLittleEndian, DeflatedExplicitVRLittleEndian):
        ds.PixelData = arr.astype(arr.dtype.newbyteorder("<")).tobytes()
        ds["PixelData"].VR = "OW"
        ds.save_as(path, implicit_vr=(ts == ImplicitVRLittleEndian), little_endian=True, enforce_file_format=True)
    elif ts == ExplicitVRBigEndian:
        ds.PixelData = arr.astype(arr.dtype.newbyteorder(">")).tobytes()
        ds["PixelData"].VR = "OW"
        ds.save_as(path, implicit_vr=False, little_endian=False, enforce_file_format=True)
    elif ts in (JPEG2000Lossless, JPEGLSLossless, RLELossless):
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.PixelData = arr.tobytes()
        ds["PixelData"].VR = "OW"
        ds.compress(ts, arr, generate_instance_uid=False)
        ds.save_as(path, enforce_file_format=True)
    elif ts == JPEG_LOSSLESS_SV1:
        import gdcm
        tmp = path + ".tmp"
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.PixelData = arr.tobytes()
        ds["PixelData"].VR = "OW"
        ds.save_as(tmp, enforce_file_format=True)
        rd = gdcm.ImageReader()
        rd.SetFileName(tmp)
        assert rd.Read(), "gdcm não leu"
        ch = gdcm.ImageChangeTransferSyntax()
        ch.SetTransferSyntax(gdcm.TransferSyntax(gdcm.TransferSyntax.JPEGLosslessProcess14_1))
        ch.SetInput(rd.GetImage())
        assert ch.Change(), "gdcm não comprimiu"
        wr = gdcm.ImageWriter()
        wr.SetFileName(path)
        wr.SetFile(rd.GetFile())
        wr.SetImage(ch.GetOutput())
        assert wr.Write(), "gdcm não gravou"
        os.remove(tmp)
    else:
        raise ValueError(ts)


def hexname():
    return "".join(RNG.choice("0123456789ABCDEF") for _ in range(12))


def new_study(desc, date="20260101"):
    return {"uid": generate_uid(), "for": generate_uid(), "desc": desc, "date": date}


def write_series(folder, study, geom, cols, rows, sx, sy, thick, *, signed=False, ts=ExplicitVRLittleEndian,
                 desc="Série", series_number=1, naming="hex", series_uid=None, hu_offset=0.0, acq=1,
                 image_type=None, padding_radius=None, wc=40, ww=400):
    series_uid = series_uid or generate_uid()
    n = len(geom)
    paths = []
    for k, (ipp, iop) in enumerate(geom):
        hu = slice_hu(ipp, iop, cols, rows, sx, sy) + hu_offset
        padding = None
        if padding_radius is not None:
            r, c = iop[:3], iop[3:]
            i = np.arange(cols)[None, :] - (cols - 1) / 2
            j = np.arange(rows)[:, None] - (rows - 1) / 2
            outside = (i * sx) ** 2 + (j * sy) ** 2 > padding_radius ** 2
            hu = np.where(outside, -3024.0, hu)
            padding = -3024
        # nº de instância invertido em relação à posição: a ordenação NÃO pode depender dele
        ds, arr = make_ds(study, series_uid, k, ipp, iop, hu, sx, sy, thick, signed, ts, desc=desc,
                          series_number=series_number, instance=n - k, acq=acq, image_type=image_type,
                          padding=padding, wc=wc, ww=ww)
        if naming == "hex":
            name = hexname()
        elif naming == "dcm_reverse":
            name = f"IMG{n - k:04d}.dcm"   # ordem lexicográfica oposta à espacial
        elif naming == "nested":
            name = os.path.join("DICOM", f"S{series_number:04d}", f"IM_{RNG.randint(0, 99999):05d}")
        else:
            name = naming(k)
        path = os.path.join(folder, name)
        while os.path.exists(path):
            path += "_"
        save(ds, arr, path, ts)
        paths.append(path)
    return series_uid, paths


def axial(cols, rows, sx, sy, zs, center=(0.0, 0.0)):
    return stack((center[0], center[1], 0.0), (1, 0, 0), (0, 1, 0), (0, 0, 1), cols, rows, sx, sy, zs)


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    manifest = {}
    zs81 = [-100 + 2.5 * k for k in range(81)]

    # 1) axial principal: pixels não quadrados (0,8 × 1,0 mm), sem extensão, nomes aleatórios
    st = new_study("Fantoma tórax — principal")
    uid, _ = write_series(f"{OUT}/ax_main", st, axial(320, 300, 1.0, 0.8, zs81), 320, 300, 1.0, 0.8, 2.5,
                          desc="Axial 2,5 mm (pixel 0,8×1,0)", wc=-600, ww=1500)
    manifest["ax_main"] = {"series": uid, "n": 81, "dims": [320, 300, 81], "spacing": [1.0, 0.8, 2.5]}

    # 2) implicit VR, com sinal, nomes .dcm em ordem lexicográfica invertida, preenchimento fora do FOV
    st = new_study("Fantoma tórax — implicit")
    uid, _ = write_series(f"{OUT}/ax_implicit", st, axial(256, 256, 1.25, 1.25, zs81), 256, 256, 1.25, 1.25, 2.5,
                          signed=True, ts=ImplicitVRLittleEndian, naming="dcm_reverse", desc="Axial implicit",
                          padding_radius=158)
    manifest["ax_implicit"] = {"series": uid, "n": 81, "dims": [256, 256, 81], "spacing": [1.25, 1.25, 2.5]}

    # 3) aquisição coronal do mesmo fantoma
    st = new_study("Fantoma tórax — coronal")
    ys = [-110 + 2.0 * k for k in range(111)]
    geom = stack((0, 0, 0), (1, 0, 0), (0, 0, -1), (0, 1, 0), 320, 220, 1.0, 1.0, ys)
    uid, _ = write_series(f"{OUT}/cor_acq", st, geom, 320, 220, 1.0, 1.0, 2.0, desc="Coronal adquirida")
    manifest["cor_acq"] = {"series": uid, "n": 111, "dims": [320, 220, 111], "spacing": [1.0, 1.0, 2.0]}

    # 4) aquisição oblíqua (rotação 20° em z e 15° em x)
    st = new_study("Fantoma tórax — oblíqua")
    R = rot("z", 20) @ rot("x", 15)
    r, c = R @ [1, 0, 0], R @ [0, 1, 0]
    n = np.cross(r, c)
    geom = stack((0, 0, 0), r, c, n, 280, 260, 1.2, 1.2, [-100 + 2.0 * k for k in range(101)])
    uid, _ = write_series(f"{OUT}/oblique", st, geom, 280, 260, 1.2, 1.2, 2.0, desc="Oblíqua 20°/15°")
    manifest["oblique"] = {"series": uid, "n": 101}

    # 5) gantry tilt de 15°: plano inclinado, mas os cortes avançam só em z (mesa)
    st = new_study("Fantoma tórax — gantry tilt")
    t = math.radians(15)
    geom = stack((0, 0, 0), (1, 0, 0), (0, math.cos(t), -math.sin(t)), (0, 0, 1), 256, 256, 1.25, 1.25, zs81)
    uid, _ = write_series(f"{OUT}/tilt", st, geom, 256, 256, 1.25, 1.25, 2.5, desc="Gantry tilt 15°")
    manifest["tilt"] = {"series": uid, "n": 81, "tilt_deg": 15}

    # 6) espaçamento irregular sem lacuna (2,0 / 3,0 mm alternados)
    st = new_study("Fantoma tórax — irregular")
    zs, z = [], -100.0
    while z <= 100:
        zs.append(z)
        z += 2.0 if len(zs) % 2 else 3.0
    uid, _ = write_series(f"{OUT}/irregular", st, axial(256, 256, 1.25, 1.25, zs), 256, 256, 1.25, 1.25, 2.5,
                          desc="Axial espaçamento irregular")
    manifest["irregular"] = {"series": uid, "n": len(zs)}

    # 7) cortes ausentes: remove 3 cortes consecutivos (lacuna de 10 mm)
    st = new_study("Fantoma tórax — lacuna")
    zs = [z for k, z in enumerate(zs81) if k not in (40, 41, 42)]
    uid, _ = write_series(f"{OUT}/gap", st, axial(256, 256, 1.25, 1.25, zs), 256, 256, 1.25, 1.25, 2.5,
                          desc="Axial com cortes ausentes")
    manifest["gap"] = {"series": uid, "n": 78, "gap_mm": 10.0, "gap_from": -2.5, "gap_to": 7.5}

    # 8) duplicados: 5 cortes de uma 2ª aquisição nas mesmas posições + cópia exata de um arquivo
    st = new_study("Fantoma tórax — duplicados")
    uid, paths = write_series(f"{OUT}/dup", st, axial(256, 256, 1.25, 1.25, zs81), 256, 256, 1.25, 1.25, 2.5,
                              desc="Axial com duplicados")
    write_series(f"{OUT}/dup", st, axial(256, 256, 1.25, 1.25, zs81[10:15]), 256, 256, 1.25, 1.25, 2.5,
                 desc="Axial com duplicados", series_uid=uid, acq=2, hu_offset=10)
    shutil.copy(paths[20], f"{OUT}/dup/copia_exata")
    manifest["dup"] = {"series": uid, "n_acq1": 81, "n_acq2": 5}

    # 9) dimensões misturadas na mesma série (256² e 512²)
    st = new_study("Fantoma tórax — dimensões mistas")
    uid, _ = write_series(f"{OUT}/mixed_dims", st, axial(256, 256, 1.25, 1.25, zs81[:60]), 256, 256, 1.25, 1.25, 2.5,
                          desc="Mista")
    write_series(f"{OUT}/mixed_dims", st, axial(512, 512, 0.625, 0.625, zs81[60:]), 512, 512, 0.625, 0.625, 2.5,
                 desc="Mista", series_uid=uid)
    manifest["mixed_dims"] = {"series": uid, "stacks": [60, 21]}

    # 10) pasta de exame com várias séries, 2 estudos, localizador, SR, arquivos inválidos e subpastas
    m = f"{OUT}/multi"
    st = new_study("TC de tórax (sintética)", "20260315")
    a, _ = write_series(m, st, axial(256, 256, 1.25, 1.25, zs81), 256, 256, 1.25, 1.25, 2.5, naming="nested",
                        series_number=3, desc="Pulmão 2,5 mm", wc=-600, ww=1500)
    b, _ = write_series(m, st, axial(256, 256, 1.25, 1.25, [-100 + 5 * k for k in range(41)]), 256, 256, 1.25, 1.25, 5,
                        naming="nested", series_number=4, desc="Mediastino 5 mm")
    loc = stack((0, 0, 0), (1, 0, 0), (0, 0, -1), (0, 1, 0), 256, 256, 1.25, 1.25, [0.0])
    lu, _ = write_series(m, st, loc, 256, 256, 1.25, 1.25, 1.0, naming="nested", series_number=1, desc="Topograma",
                         image_type=["ORIGINAL", "PRIMARY", "LOCALIZER"])
    st2 = new_study("TC de tórax anterior (sintética)", "20250110")
    c2, _ = write_series(m, st2, axial(256, 256, 1.25, 1.25, [-100 + 5 * k for k in range(41)]), 256, 256, 1.25, 1.25, 5,
                         naming="nested", series_number=2, desc="Controle 5 mm")
    # SR sem pixels
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.88.11"
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    sr = Dataset()
    sr.file_meta = meta
    sr.SOPClassUID = meta.MediaStorageSOPClassUID
    sr.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    sr.Modality = "SR"
    sr.PatientName = FAKE_NAME
    sr.StudyInstanceUID = st["uid"]
    sr.SeriesInstanceUID = generate_uid()
    sr.save_as(f"{m}/DICOM/SR000001", enforce_file_format=True)
    # inválidos
    os.makedirs(f"{m}/extras", exist_ok=True)
    open(f"{m}/extras/leia-me.txt", "w").write("arquivo de texto qualquer\n" * 50)
    open(f"{m}/extras/ruido.bin", "wb").write(bytes(RNG.getrandbits(8) for _ in range(6000)))
    open(f"{m}/extras/vazio", "wb").close()
    good = open(_first_file(f"{m}/DICOM/S0003"), "rb").read()
    open(f"{m}/extras/truncado", "wb").write(good[:900])
    open(f"{m}/.DS_Store", "wb").write(b"\x00\x00\x00\x01Bud1" + bytes(3000))
    manifest["multi"] = {"studies": 2, "series_A": a, "series_B": b, "localizer": lu, "series_C": c2}

    # 11) codecs e sintaxes de transferência (mesma geometria pequena; sem perdas → HU idêntico à referência)
    geom = axial(128, 128, 2.5, 2.5, [-60 + 5 * k for k in range(24)])
    cod = {}
    for name, ts, signed in [
        ("ref", ExplicitVRLittleEndian, True),
        ("j2k", JPEG2000Lossless, True),
        ("j2k_unsigned", JPEG2000Lossless, False),
        ("jls", JPEGLSLossless, True),
        ("rle", RLELossless, True),
        ("jpegll", JPEG_LOSSLESS_SV1, True),
        ("deflate", DeflatedExplicitVRLittleEndian, True),
        ("bigendian", ExplicitVRBigEndian, True),
    ]:
        st = new_study(f"Codec {name}")
        uid, _ = write_series(f"{OUT}/codecs/{name}", st, geom, 128, 128, 2.5, 2.5, 5, signed=signed, ts=ts,
                              desc=f"Codec {name}")
        cod[name] = {"series": uid, "ts": str(ts)}
    manifest["codecs"] = cod

    # 12) Enhanced CT multi-frame (um arquivo, 24 quadros, grupos funcionais)
    write_enhanced(f"{OUT}/enhanced/ENHANCED_CT", geom, 128, 128, 2.5, 2.5)
    manifest["enhanced"] = {"frames": 24}

    # 13) .zip da pasta multi
    with zipfile.ZipFile(f"{OUT}/multi.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(m):
            for f in files:
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, OUT))

    json.dump(manifest, open(f"{OUT}/manifest.json", "w"), indent=1)
    print("ok", OUT)


def _first_file(folder):
    return os.path.join(folder, sorted(os.listdir(folder))[0])


def write_enhanced(path, geom, cols, rows, sx, sy):
    st = new_study("Enhanced CT")
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = ENHANCED_CT
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID = ENHANCED_CT
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.SpecificCharacterSet = "ISO_IR 192"
    ds.PatientName = FAKE_NAME
    ds.PatientID = FAKE_ID
    ds.StudyInstanceUID = st["uid"]
    ds.StudyDescription = st["desc"]
    ds.SeriesInstanceUID = generate_uid()
    ds.SeriesDescription = "Enhanced multi-frame"
    ds.SeriesNumber = 7
    ds.FrameOfReferenceUID = st["for"]
    ds.Modality = "CT"
    ds.ImageType = ["ORIGINAL", "PRIMARY", "AXIAL", "NONE"]
    ds.InstanceNumber = 1
    ds.Rows, ds.Columns = rows, cols
    ds.NumberOfFrames = len(geom)
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
    sh = Dataset()
    pm = Dataset()
    pm.PixelSpacing = fmt([sy, sx])
    pm.SliceThickness = "5"
    sh.PixelMeasuresSequence = Sequence([pm])
    po = Dataset()
    po.ImageOrientationPatient = fmt(geom[0][1])
    sh.PlaneOrientationSequence = Sequence([po])
    pv = Dataset()
    pv.RescaleIntercept, pv.RescaleSlope, pv.RescaleType = "0", "1", "HU"
    sh.PixelValueTransformationSequence = Sequence([pv])
    ds.SharedFunctionalGroupsSequence = Sequence([sh])
    per, frames = [], []
    order = list(range(len(geom)))
    RNG.shuffle(order)          # quadros fora de ordem espacial
    for k in order:
        ipp, iop = geom[k]
        it = Dataset()
        pp = Dataset()
        pp.ImagePositionPatient = fmt(ipp)
        it.PlanePositionSequence = Sequence([pp])
        per.append(it)
        frames.append(np.round(slice_hu(ipp, iop, cols, rows, sx, sy)).astype("<i2"))
    ds.PerFrameFunctionalGroupsSequence = Sequence(per)
    ds.PixelData = np.stack(frames).tobytes()
    ds["PixelData"].VR = "OW"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ds.save_as(path, enforce_file_format=True)


if __name__ == "__main__":
    main()
