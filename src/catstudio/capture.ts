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
  await download(blob, `catstudio-${kind}-${stamp()}.png`);
}

/**
 * Entrega um arquivo gerado no navegador (PNG, vídeo) como download. Dentro
 * do Claude (CatStudio aberto como artefato) o download comum é bloqueado; lá
 * vale a capacidade "downloads" da página.
 */
export async function download(blob: Blob, name: string) {
  const host = (globalThis as any).claude;
  if (host && typeof host.use === 'function') {
    try {
      const downloads = await host.use('downloads');
      if (downloads) {
        await downloads.save({ filename: name, data: blob });
        return;
      }
    } catch {
      // recusado ou indisponível: tenta o download comum
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
