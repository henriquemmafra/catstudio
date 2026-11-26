/**
 * CatStudio — diretor de arte: pedido à IA, pela nuvem do CineDeck.
 *
 * O CineDeck e o CatStudio são servidos pelo mesmo endereço (GitHub Pages do
 * mesmo usuário), então a configuração de nuvem que o CineDeck guarda no
 * navegador (endereço da IA + chave) vale aqui sem configurar de novo.
 *
 * Sai do computador: o texto do pedido, a receita em uso e meia dúzia de
 * números de geometria (larguras e alturas em mm). Nenhuma imagem, nenhum
 * voxel, nada do cabeçalho DICOM.
 */
import type { Landmarks } from '@/src/catstudio/director/landmarks';
import { sanitizeRecipe, type Recipe } from '@/src/catstudio/director/recipe';

/** Chave do armazenamento local usada pelo CineDeck ("Configurar nuvem"). */
export const CLOUD_STORAGE_KEY = 'cinedeck_nuvem';

export interface CloudConfig {
  ia: string;
  key: string;
}

export function cloudConfig(): CloudConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw.ia !== 'string' || !/^https:\/\//.test(raw.ia))
      return null;
    return {
      ia: raw.ia.replace(/\/+$/, ''),
      key: typeof raw.key === 'string' ? raw.key : '',
    };
  } catch {
    return null;
  }
}

/** Tira do pedido o que parece identificação (números longos: registro, CPF). */
export function scrub(text: string) {
  return text.replace(/\d{6,}/g, '[número]').slice(0, 600);
}

/** O que a IA recebe sobre o exame: só geometria, arredondada. */
export function examSummary(lm: Landmarks) {
  const round = (value: number) => Math.round(value);
  return {
    referencias: lm.basis,
    meia_largura_esquerda_mm: round(lm.halfWidthLeft),
    meia_largura_direita_mm: round(lm.halfWidthRight),
    altura_dos_pulmoes_mm: round(lm.apexZ - lm.baseZ),
    altura_do_corpo_mm: round(lm.body[1][2] - lm.body[0][2]),
    pulmoes_do_apice_a_base_abaixo_do_topo_mm: [
      round(lm.body[1][2] - lm.apexZ),
      round(lm.body[1][2] - lm.baseZ),
    ],
  };
}

export type CloudFailure = 'sem-rota' | 'chave' | 'rede' | 'resposta';

export interface CloudAnswer {
  recipe: Recipe;
  comment: string;
}

export class CloudError extends Error {
  constructor(public reason: CloudFailure) {
    super(reason);
  }
}

export const CLOUD_FAILURE_TEXT: Record<CloudFailure, string> = {
  'sem-rota':
    'A nuvem do CineDeck ainda não tem o diretor de arte (falta publicar a versão nova da IA).',
  chave: 'A nuvem recusou a chave guardada neste navegador.',
  rede: 'Não consegui falar com a nuvem.',
  resposta: 'A IA respondeu fora do formato esperado.',
};

const TIMEOUT_MS = 30_000;

function failureOf(status: number): CloudFailure {
  if (status === 404 || status === 405) return 'sem-rota';
  if (status === 401 || status === 403) return 'chave';
  if (status === 502) return 'resposta'; // a rota existe, a IA respondeu torto
  return 'rede';
}

/**
 * Pede a receita à IA. Lança CloudError com o motivo quando não dá; quem
 * chama cai no interpretador local.
 */
export async function askCloud(
  config: CloudConfig,
  request: { text: string; current: Recipe | null; landmarks: Landmarks },
  fetcher: typeof fetch = fetch
): Promise<CloudAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`${config.ia}/diretor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cinedeck-key': config.key,
      },
      body: JSON.stringify({
        pedido: scrub(request.text),
        atual: request.current,
        exame: examSummary(request.landmarks),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new CloudError('rede');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new CloudError(failureOf(response.status));
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new CloudError('resposta');
  }
  if (!body || typeof body.receita !== 'object' || !body.receita)
    throw new CloudError('resposta');
  return {
    // a resposta é conferida campo a campo; nada dela é executado
    recipe: sanitizeRecipe(body.receita, request.current ?? undefined),
    comment:
      typeof body.comentario === 'string' ? body.comentario.slice(0, 300) : '',
  };
}
