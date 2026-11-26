/**
 * CatStudio — fechar o exame e voltar à tela inicial.
 */
import { useDatasetStore } from '@/src/store/datasets';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { forgetSculpts } from '@/src/catstudio/sculpt/state';
import { valveMode } from '@/src/catstudio/valveMode';
import { directorMode } from '@/src/catstudio/director/mode';

export function closeExam() {
  valveMode.open = false;
  directorMode.open = false;
  const datasets = useDatasetStore();
  // as séries DICOM não estão na lista que o removeAll percorre
  Object.keys(useDICOMStore().volumeInfo).forEach((id) => datasets.remove(id));
  datasets.removeAll();
  forgetSculpts();
}
