import { describe, it, expect } from 'vitest';
import { filterExamFiles, mimeFromName } from '@/src/catstudio/folderFilter';

const file = (name: string) => new File(['x'], name);
// nos testes, DICOM sem extensão é o que começa com "IM"
const isDicom = async (f: File) => f.name.startsWith('IM');
const names = (files: File[]) => files.map((f) => f.name);

describe('filterExamFiles', () => {
  it('descarta miniaturas, logotipos e o visualizador quando há DICOM', async () => {
    const files = [
      'AGFA_LOG.PNG',
      'image00001.jpg',
      'image00002.jpg',
      'IM000001',
      'IM000002',
      'corte.dcm',
      'viewer.exe',
      'autorun.inf',
    ].map(file);
    const { kept, skipped } = await filterExamFiles(files, isDicom);
    expect(names(kept)).toEqual(['IM000001', 'IM000002', 'corte.dcm']);
    expect(skipped).toHaveLength(5);
  });

  it('mantém volumes, segmentações e sessões ao lado do DICOM', async () => {
    const files = [
      'IM1',
      'IM2',
      'mask.seg.nrrd',
      'ct.nii.gz',
      'sessao.zip',
    ].map(file);
    const { kept, skipped } = await filterExamFiles(files, isDicom);
    expect(kept).toHaveLength(5);
    expect(skipped).toHaveLength(0);
  });

  it('não mexe em seleções sem DICOM', async () => {
    const files = ['a.jpg', 'b.png', 'leia-me.txt'].map(file);
    const { kept, skipped } = await filterExamFiles(files, isDicom);
    expect(kept).toEqual(files);
    expect(skipped).toHaveLength(0);
  });

  it('não lê nada quando é um arquivo só', async () => {
    const files = [file('a.jpg')];
    const { kept } = await filterExamFiles(files, async () => {
      throw new Error('não deveria ler');
    });
    expect(kept).toEqual(files);
  });

  it('arquivo ilegível é tratado como não DICOM', async () => {
    const files = ['IM1', 'ruim', 'x.jpg'].map(file);
    const { kept } = await filterExamFiles(files, async (f) => {
      if (f.name === 'ruim') throw new Error('leitura falhou');
      return f.name.startsWith('IM');
    });
    expect(names(kept)).toEqual(['IM1']);
  });
});

describe('mimeFromName', () => {
  it('reconhece extensão dupla e ignora maiúsculas', () => {
    expect(mimeFromName('ct.nii.gz')).toBe('application/vnd.unknown.nifti-1');
    expect(mimeFromName('AGFA_LOG.PNG')).toBe('image/png');
    expect(mimeFromName('IM000001')).toBeUndefined();
  });
});
