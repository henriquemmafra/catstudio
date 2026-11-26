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

export const MAX_EXPORT_SIDE = 4096;

/** Fator realmente usado: o maior lado da imagem não passa de 4096 px. */
export function exportScale(size: ArrayLike<number>, wanted: number): number {
  const side = Math.max(size[0], size[1], 1);
  return Math.max(1, Math.min(wanted, MAX_EXPORT_SIDE / side));
}

export interface HiResOptions {
  scale: number;
  /** espera a vista terminar de refinar o quadro no tamanho novo */
  settle: () => Promise<void>;
  kind?: string;
}

/**
 * Exporta a vista num tamanho maior que o da tela (para slide e pôster): a
 * vista é redesenhada maior, capturada e devolvida ao tamanho normal. A trava
 * do 3D continua valendo — em placa fraca o quadro grande pode sair com
 * resolução interna reduzida em vez de travar a página.
 */
export async function captureViewHiRes(
  view: VtkViewApi,
  options: HiResOptions
) {
  const own = view.renderWindowView as any;
  const root = own.getRootOpenGLRenderWindow?.() ?? own;
  const [width, height] = own.getSize() as [number, number];
  const scale = exportScale([width, height], options.scale);
  const resize = (w: number, h: number) => {
    own.setSize(Math.round(w), Math.round(h));
    root.resizeFromChildRenderWindows?.();
    view.requestRender({ immediate: true });
  };
  resize(width * scale, height * scale);
  try {
    await options.settle();
    await captureViewPNG(
      view,
      `${options.kind ?? '3d'}-${Math.round(width * scale)}px`
    );
  } finally {
    resize(width, height);
  }
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
