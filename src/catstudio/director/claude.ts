/**
 * CatStudio — diretor de arte dentro do Claude. Quando o CatStudio é aberto
 * como artefato no Claude, a página pode perguntar ao próprio Claude
 * (capacidade "sample"), sem servidor nem chave. Vai o mesmo que iria para a
 * nuvem: o texto do pedido, a receita em uso e a geometria do exame em
 * números. Nenhuma imagem.
 */
import type { Landmarks } from '@/src/catstudio/director/landmarks';
import {
  examSummary,
  scrub,
  type CloudAnswer,
} from '@/src/catstudio/director/cloud';
import { sanitizeRecipe, type Recipe } from '@/src/catstudio/director/recipe';

/** As mesmas instruções da rota /diretor da nuvem do CineDeck. */
export const DIRECTOR_INSTRUCTIONS = `Você é o diretor de arte do CatStudio, um visualizador de tomografia para um radiologista. Ele descreve em português a imagem que quer e você devolve a RECEITA do corte. Você NÃO vê o exame: recebe só o pedido, a receita em uso (ou null) e alguns números de geometria. Quem desenha é o programa.

Campos da receita (use exatamente estes valores):
- plano: "axial" | "coronal" | "sagital"
- referencia: onde o corte passa.
    sagital: "linha-media", "hemiclavicular-esquerda", "hemiclavicular-direita", "paraesternal-esquerda", "paraesternal-direita", "centro", "ponto"
    coronal: "axilar-media", "centro", "ponto"
    axial:   "apice-pulmonar", "base-pulmonar", "centro", "ponto"
  "ponto" é uma posição que o usuário marcou clicando; só mantenha se já estiver na receita em uso.
- deslocamento: mm a partir da referência, no eixo do paciente. sagital: + esquerda do paciente, − direita. coronal: + posterior, − anterior. axial: + cranial, − caudal. "Lateral" afasta da linha média do lado do corte.
- projecao: "fina" | "mip" | "minip" | "media" | "3d";  espessura: mm (1 a 300; ignorada em "fina"). "3d" é a reconstrução 3D recortada no plano: o observador olha para a face do corte e, através do ar (pulmões), para o que está atrás; nela a espessura é a profundidade (padrão 160) e a janela escolhe as cores ("osso": só o esqueleto; "angio": vasos com contraste em destaque; as outras: tecidos).
- janela: "partes-moles" | "mediastino" | "pulmao" | "osso" | "abdome" | "angio" | "cerebro"
- campo: "tudo" | "torax" | "abdome"
- fundo: cor "#rrggbb" em volta da imagem (padrão "#000000")
- titulo: legenda curta opcional

Regras:
- Com receita em uso e um pedido de ajuste ("2 cm mais lateral", "janela de pulmão"), devolva a receita em uso com só o que foi pedido alterado; deslocamentos se somam ao que já havia. Pedido de outro plano começa uma receita nova.
- Escolha janela, projeção e campo pelo que ele quer mostrar (vasos: angio e MIP; via aérea e enfisema: pulmão, MinIP se pedir; parede, hérnia e abdome: partes moles). Na dúvida, corte fino e campo "tudo".
- Você não sabe onde está nenhuma lesão. Se o pedido depende de achar um achado (uma hérnia, um nódulo), faça o corte na referência pedida e diga no comentário que ele pode clicar no localizador para o corte passar pelo achado.
- Não invente referência que não está na lista; se pedirem algo fora dela (carina, um nível vertebral), use a mais próxima e diga isso no comentário.
- O comentário é uma frase curta, em português, sem nomes nem dados de paciente.
Responda SOMENTE com JSON: {"receita": {...todos os campos...}, "comentario": "<frase>"}`;

/** O que a capacidade "sample" do Claude oferece e este módulo usa. */
export interface ClaudeSample {
  json(input: string, options?: Record<string, unknown>): Promise<unknown>;
}

interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

/**
 * A capacidade de perguntar ao Claude, ou null fora do Claude (no site, por
 * exemplo). Nunca lança erro.
 */
export async function claudeSample(
  host: unknown = (globalThis as any).claude
): Promise<ClaudeSample | null> {
  if (!host || typeof (host as ClaudeHost).use !== 'function') return null;
  try {
    const sample = (await (host as ClaudeHost).use('sample')) as any;
    return sample && typeof sample.json === 'function' ? sample : null;
  } catch {
    return null;
  }
}

export function directorPrompt(request: {
  text: string;
  current: Recipe | null;
  landmarks: Landmarks;
}) {
  return [
    DIRECTOR_INSTRUCTIONS,
    `PEDIDO:\n${scrub(request.text)}`,
    `RECEITA EM USO:\n${JSON.stringify(request.current)}`,
    `GEOMETRIA DO EXAME (mm):\n${JSON.stringify(examSummary(request.landmarks))}`,
  ].join('\n\n');
}

/** Pede a receita ao Claude. Lança erro se ele recusar ou responder torto. */
export async function askClaude(
  sample: ClaudeSample,
  request: { text: string; current: Recipe | null; landmarks: Landmarks }
): Promise<CloudAnswer> {
  const answer = (await sample.json(directorPrompt(request), {
    modelTier: 'default',
    cache: false,
  })) as { receita?: unknown; comentario?: unknown } | null;
  if (!answer || typeof answer.receita !== 'object' || !answer.receita)
    throw new Error('resposta fora do formato');
  return {
    // conferida campo a campo; nada da resposta é executado
    recipe: sanitizeRecipe(answer.receita, request.current ?? undefined),
    comment:
      typeof answer.comentario === 'string'
        ? answer.comentario.slice(0, 300)
        : '',
  };
}
