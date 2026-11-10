/**
 * CatStudio — exporta a imagem de uma vista como PNG, para aulas e
 * apresentações. Captura só o conteúdo renderizado (sem textos sobrepostos,
 * nome da série ou dados do paciente) e baixa o arquivo localmente.
 */
import type { VtkViewApi } from '@/src/types/vtk-types';

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function captureViewPNG(view: VtkViewApi, kind = '3d') {
  // O canvas da vista guarda o último quadro renderizado; capturar direto evita
  // uma nova renderização cinematográfica (lenta em GPU fraca).
  const canvas = view.renderWindowView.getCanvas() as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Vista sem canvas para capturar');
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('Falha ao gerar o PNG');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `catstudio-${kind}-${stamp()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
