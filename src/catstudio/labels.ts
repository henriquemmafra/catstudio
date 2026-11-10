/**
 * CatStudio — rótulos em português para a interface herdada do VolView.
 *
 * Os identificadores internos do VolView (nomes de ferramentas, layouts,
 * presets) continuam em inglês para não quebrar estado salvo, atalhos e
 * testes; só o texto exibido passa por `pt()`.
 */
const LABELS: Record<string, string> = {
  // abas
  Data: 'Dados',
  Annotations: 'Anotações',
  Rendering: 'Renderização',
  Remote: 'Remoto',
  Jobs: 'Tarefas',
  // ferramentas
  'Window & Level': 'Janela e nível',
  Pan: 'Mover',
  Zoom: 'Zoom',
  Crosshairs: 'Cursor cruzado',
  Select: 'Selecionar',
  Paint: 'Pintar',
  Rectangle: 'Retângulo',
  Polygon: 'Polígono',
  Ruler: 'Régua',
  Crop: 'Recortar',
  // layouts
  'Four Up': 'Quatro quadrantes',
  'Axial Coronal Sagittal': 'Axial + coronal + sagital',
  'Axial Only': 'Somente axial',
  '3D Only': 'Somente 3D',
  Oblique: 'Oblíquo (MPR livre)',
  '3D Primary': '3D em destaque',
  // vistas
  Axial: 'Axial',
  Coronal: 'Coronal',
  Sagittal: 'Sagital',
  Volume: 'Volume 3D',
  // W/L automático
  FullRange: 'Faixa completa',
  LowContrast: 'Contraste baixo',
  MediumContrast: 'Contraste médio',
  HighContrast: 'Contraste alto',
};

export function pt(text: string) {
  return LABELS[text] ?? text;
}

/** Presets de renderização volumétrica (nomes do VolView/3D Slicer). */
const PRESETS: Record<string, string> = {
  'CT-AAA': 'Aorta (angio-TC)',
  'CT-AAA2': 'Aorta (angio-TC) 2',
  'CT-Bone': 'Osso',
  'CT-Bones': 'Esqueleto',
  'CT-Cardiac': 'Cardíaco',
  'CT-Cardiac2': 'Cardíaco 2',
  'CT-Cardiac3': 'Cardíaco 3',
  'CT-Chest-Contrast-Enhanced': 'Tórax com contraste',
  'CT-Chest-Vessels': 'Vasos do tórax',
  'CT-Coronary-Arteries': 'Coronárias',
  'CT-Coronary-Arteries-2': 'Coronárias 2',
  'CT-Coronary-Arteries-3': 'Coronárias 3',
  'CT-Cropped-Volume-Bone': 'Osso (volume recortado)',
  'CT-Fat': 'Gordura',
  'CT-Liver-Vasculature': 'Vasos hepáticos',
  'CT-Lung': 'Pulmão',
  'CT-MIP': 'MIP',
  'CT-Muscle': 'Músculo',
  'CT-Pulmonary-Arteries': 'Artérias pulmonares',
  'CT-Soft-Tissue': 'Partes moles',
  'CT-Air': 'Vias aéreas',
  'CT-X-ray': 'Radiografia simulada',
};

export function presetLabel(name: string) {
  return PRESETS[name] ?? name;
}
