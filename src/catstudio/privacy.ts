/**
 * CatStudio — privacidade.
 *
 * Os arquivos DICOM nunca saem do navegador. Além disso, a identificação do
 * paciente não é mostrada em nenhuma tela (painel de dados, informações da
 * série, capturas): cada paciente recebe um pseudônimo ("Paciente 1", …)
 * válido só nesta aba. Os metadados originais continuam nos arquivos, que o
 * usuário carregou, mas não entram na interface nem nos logs.
 */
const pseudonyms = new Map<string, number>();

export interface PatientFields {
  PatientID: string;
  PatientName: string;
  PatientBirthDate: string;
  PatientSex: string;
}

export function pseudonymizePatient(
  info: Partial<PatientFields>
): PatientFields {
  // agrupa pelo identificador original sem guardá-lo na interface
  const key = [info.PatientID, info.PatientName, info.PatientBirthDate]
    .map((v) => (v ?? '').trim())
    .join('\u0000');
  if (!pseudonyms.has(key)) pseudonyms.set(key, pseudonyms.size + 1);
  const n = pseudonyms.get(key)!;
  return {
    PatientID: `paciente-${n}`,
    PatientName: `Paciente ${n}`,
    PatientBirthDate: '',
    PatientSex: '',
  };
}

/** Campos do estudo que identificam o atendimento (não o exame) ficam ocultos. */
export function scrubStudy<
  T extends { StudyID?: string; AccessionNumber?: string },
>(study: T): T {
  return { ...study, StudyID: '', AccessionNumber: '' };
}
