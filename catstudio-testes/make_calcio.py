"""Fantoma do escore de cálcio para o teste do Ostium.

Série axial sem contraste, 3 mm, 120 kVp, 48 cortes de 512×512 (pixel 0,4 mm),
com três calcificações de Agatston conhecido e estruturas que NÃO devem contar:

    foco A (DA)  cortes 20 e 21, 30 px (4,8 mm²), pico 450 UH -> 2 × 4,8 × 4 = 38,4
    foco B (CX)  corte 25, 16 px (2,56 mm²), 250 UH           -> 2,56 × 2     = 5,12
    foco C (CD)  corte 30, 20 px (3,2 mm²), 180 UH            -> 3,2 × 1      = 3,2
    ruído        1 px de 600 UH no corte 22 (< 1 mm²: ignorado)
    coluna e esterno: grandes demais para virar foco candidato

    python3 catstudio-testes/make_calcio.py
"""
import os

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

from make_fixtures import FAKE_ID, FAKE_NAME

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, ".data", "calcio")
ESPERADO = {"TCE": 0, "DA": 38, "CX": 5, "CD": 3}  # arredondado, como vai para o laudo
FOCOS = {"DA": (20, 252, 232), "CX": (25, 301, 241), "CD": (30, 202, 261)}  # corte, coluna, linha


def main():
    os.makedirs(OUT, exist_ok=True)
    study, series = generate_uid(), generate_uid()
    yy, xx = np.mgrid[0:512, 0:512]
    base = np.full((512, 512), -1000, np.int16)
    base[((xx - 256) / 200) ** 2 + ((yy - 256) / 150) ** 2 < 1] = 40
    for cx in (160, 352):
        base[((xx - cx) / 70) ** 2 + ((yy - 250) / 90) ** 2 < 1] = -850
    base[(xx - 256) ** 2 + (yy - 360) ** 2 < 28 ** 2] = 500  # coluna
    base[(abs(xx - 256) < 30) & (abs(yy - 118) < 8)] = 420  # esterno
    for i in range(48):
        im = base.copy()
        if i in (20, 21):
            im[230:235, 250:256] = 300
            im[232, 252] = 450
        if i == 25:
            im[240:244, 300:304] = 250
        if i == 30:
            im[260:264, 200:205] = 180
        if i == 22:
            im[200, 280] = 600
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
        ds.Modality, ds.SeriesDescription = "CT", "CaScore 3.0"
        ds.PatientName, ds.PatientID = FAKE_NAME, FAKE_ID
        ds.PatientBirthDate, ds.PatientAge, ds.PatientSex = "19630101", "063Y", "M"
        ds.StudyDate, ds.StudyTime = "20260601", "120000"
        ds.ImageType = ["ORIGINAL", "PRIMARY", "AXIAL"]
        ds.KVP, ds.SliceThickness = "120", "3"
        ds.Rows = ds.Columns = 512
        ds.PixelSpacing = [0.4, 0.4]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = [-102.4, -102.4, -3.0 * i]  # corte 0 é o mais alto
        ds.InstanceNumber = i + 1
        ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
        ds.BitsAllocated = ds.BitsStored = 16
        ds.HighBit, ds.PixelRepresentation = 15, 0
        ds.RescaleIntercept, ds.RescaleSlope = "-1024", "1"
        ds.PixelData = (im.astype(np.int32) + 1024).astype(np.uint16).tobytes()
        ds.save_as(os.path.join(OUT, f"IM{i:04d}"), enforce_file_format=True)
    print(f"ok: {OUT}")


if __name__ == "__main__":
    main()
