/**
 * CatStudio — diretor de arte: perguntar à IA (o Claude, quando o CatStudio
 * está aberto dentro dele, ou a nuvem do CineDeck). Sem IA disponível, ou se
 * ela falhar, devolve null e o interpretador local assume.
 */
import { askClaude, type ClaudeSample } from './claude';
import {
  CLOUD_FAILURE_TEXT,
  CloudError,
  askCloud,
  type CloudConfig,
} from './cloud';
import type { Landmarks } from './landmarks';
import type { Recipe } from './recipe';

export interface AskContext {
  claude: ClaudeSample | null;
  cloud: CloudConfig | null;
  current: Recipe | null;
  /** texto de andamento */
  say: (text: string) => void;
  /** aviso para a pessoa */
  note: (text: string) => void;
}

async function fromClaude(request: string, lm: Landmarks, ctx: AskContext) {
  if (!ctx.claude) return null;
  ctx.say('Perguntando ao Claude…');
  try {
    return await askClaude(ctx.claude, {
      text: request,
      current: ctx.current,
      landmarks: lm,
    });
  } catch {
    ctx.note('O Claude não respondeu ao pedido.');
    return null;
  }
}

async function fromCloud(request: string, lm: Landmarks, ctx: AskContext) {
  if (!ctx.cloud) {
    if (ctx.claude) ctx.note('Usei o interpretador local.');
    return null;
  }
  ctx.say('Perguntando à IA…');
  try {
    return await askCloud(ctx.cloud, {
      text: request,
      current: ctx.current,
      landmarks: lm,
    });
  } catch (error) {
    const reason = error instanceof CloudError ? error.reason : 'rede';
    ctx.note(`${CLOUD_FAILURE_TEXT[reason]} Usei o interpretador local.`);
    return null;
  }
}

/** A resposta da IA (receita e comentário), ou null. */
export async function askAi(request: string, lm: Landmarks, ctx: AskContext) {
  return (
    (await fromClaude(request, lm, ctx)) ?? (await fromCloud(request, lm, ctx))
  );
}
