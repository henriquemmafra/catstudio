/**
 * CatStudio — trava de segurança da renderização 3D.
 *
 * Um quadro cinematográfico (sombras, oclusão ambiente, qualidade alta) em
 * resolução total pode levar dezenas de segundos numa placa de vídeo modesta.
 * Enquanto ele não termina, a placa fica presa e o navegador inteiro para de
 * responder. Não dá para interromper um quadro já enviado, então a saída é
 * nunca enviar um quadro cujo custo não foi medido.
 *
 * Todo quadro parado depois de uma mudança (câmera, preset, luz, recorte…)
 * começa numa fração dos pixels e é refinado em etapas. O tempo de cada etapa
 * prevê o da seguinte (o custo é proporcional ao número de pixels); se a
 * previsão passa do limite, o refino para ali e a vista avisa que está em
 * resolução reduzida. Quando a primeira medida já mostra que o quadro total é
 * rápido, ele é desenhado em seguida, antes de a tela ser atualizada, e não se
 * vê o degrau reduzido.
 */
import { reactive } from 'vue';

/** Fatores de redução de área, do mais grosso ao total. */
// (64 = 1/8 da largura, 16 = 1/4, 9 = 1/3, 4 = 1/2, 2,25 = 2/3)
export const LADDER = [64, 16, 9, 4, 2.25, 1] as const;

/** Tempo máximo previsto para um único quadro parado. */
export const FRAME_BUDGET_MS = 700;

/**
 * Se a primeira medida prevê o quadro total abaixo disto, ele é desenhado
 * imediatamente, sem esperar as mudanças pararem.
 */
export const FAST_FRAME_MS = 300;

/** Tempo alvo de um quadro enquanto se gira ou arrasta o volume. */
export const INTERACTIVE_FRAME_MS = 45;

/** Maior redução de área durante a interação (1/16 da largura). */
export const MAX_INTERACTION_SCALE = 256;

/**
 * Fator de redução de área para um quadro de interação caber no tempo alvo,
 * dado o tempo estimado do quadro em resolução total. Arredondado em degraus
 * de 25% para a resolução não oscilar a cada quadro.
 */
export function interactionScale(
  fullMs: number,
  target = INTERACTIVE_FRAME_MS
): number {
  if (!(fullMs > 0)) return 1;
  const raw = Math.min(MAX_INTERACTION_SCALE, Math.max(1, fullMs / target));
  const step = Math.round(Math.log(raw) / Math.log(1.25));
  return Number(1.25 ** step);
}

/** Espera, após a última mudança, antes de começar a refinar. */
export const SETTLE_MS = 160;

/**
 * Próxima etapa a partir de uma medida: a mais fina cujo tempo previsto cabe
 * no limite. `null` quando nenhuma etapa mais fina cabe.
 */
export function nextScale(
  scale: number,
  ms: number,
  budget = FRAME_BUDGET_MS,
  ladder: readonly number[] = LADDER
): number | null {
  let best: number | null = null;
  ladder.forEach((candidate) => {
    if (candidate >= scale) return;
    const predicted = ms * (scale / candidate);
    if (predicted <= budget && (best === null || candidate < best))
      best = candidate;
  });
  return best;
}

/** Tempo previsto do quadro em resolução total a partir de uma etapa. */
export const predictFull = (scale: number, ms: number) => ms * scale;

export interface GuardStatus {
  /** fator de redução de área do quadro exibido (1 = resolução total) */
  scale: number;
  /** o refino parou antes da resolução total para não travar */
  limited: boolean;
  /** há etapas de refino pendentes */
  refining: boolean;
  /** tempo previsto (ms) do quadro total, quando limitado */
  fullEstimateMs: number;
}

const statuses = reactive<Record<string, GuardStatus>>({});

export function guardStatus(viewID: string): GuardStatus {
  if (!statuses[viewID])
    statuses[viewID] = {
      scale: 1,
      limited: false,
      refining: false,
      fullEstimateMs: 0,
    };
  return statuses[viewID];
}

export function dropGuardStatus(viewID: string) {
  delete statuses[viewID];
}

export interface GuardHost {
  /** o interactor está em animação (arrastando, girando) */
  isAnimating(): boolean;
  /** identifica o estado da cena; muda sempre que o quadro mudaria */
  signature(): string;
  /** aplica o fator de redução aos próximos quadros parados (0/1 = total) */
  setScale(scale: number): void;
  /** fator de redução dos quadros durante a interação (1 = total) */
  setInteractionScale(scale: number): void;
  /** renderiza agora e devolve o tempo até a placa terminar, em ms */
  renderTimed(): number;
  /** roda `fn` logo após o quadro atual, antes de a tela ser atualizada */
  afterCurrentRender(fn: () => void): void;
  /** espera a página respirar entre etapas */
  yieldFrame(): Promise<void>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface RenderGuard {
  /** chamar no início de todo quadro do volume, antes de desenhar */
  beforeRender(): void;
  /** chamar quando a placa terminou um quadro que o guarda não iniciou */
  afterExternalRender(ms: number): void;
  /** o último quadro externo deve ser cronometrado */
  wantsTiming(): boolean;
  dispose(): void;
}

/**
 * Máquina de estados do refino. Não conhece vtk: recebe um `GuardHost`, o que
 * permite testar as decisões com tempos simulados.
 */
export function createRenderGuard(
  host: GuardHost,
  status: GuardStatus,
  options: { budget?: number; fast?: number; settle?: number } = {}
): RenderGuard {
  const budget = options.budget ?? FRAME_BUDGET_MS;
  const fast = options.fast ?? FAST_FRAME_MS;
  const settleDelay = options.settle ?? SETTLE_MS;

  let settledSignature = '';
  let inLadder = false;
  let job = 0;
  let timer: unknown = null;
  let timeExternal = false;
  let disposed = false;
  // tempo estimado do quadro em resolução total: parado (com os ajustes
  // cinematográficos) e em interação (render clássico, mais barato)
  let stillFullMs = 0;
  let interactiveFullMs = 0;
  let animationScale = 1;
  let animationFrames = 0;

  const apply = (scale: number) => {
    host.setScale(scale);
    status.scale = scale;
  };

  const settle = (scale: number, ms: number) => {
    status.limited = scale > 1;
    status.fullEstimateMs = scale > 1 ? predictFull(scale, ms) : 0;
    stillFullMs = predictFull(scale, ms);
    settledSignature = host.signature();
  };

  const cancelled = (mine: number) =>
    disposed || mine !== job || host.isAnimating();

  /** Primeira medida do refino, no degrau mais grosso. */
  function measureCoarse() {
    apply(LADDER[0]);
    const ms = host.renderTimed();
    // o primeiro quadro paga compilação de shader e envio de textura;
    // repetir separa esse custo fixo do custo por pixel
    return ms > fast / 4 ? Math.min(ms, host.renderTimed()) : ms;
  }

  /** Sobe os degraus enquanto a previsão couber; devolve onde parou. */
  async function climb(mine: number, fromMs: number) {
    let scale: number = LADDER[0];
    let ms = fromMs;
    let next = nextScale(scale, ms, budget);
    while (next !== null) {
      await host.yieldFrame();
      if (cancelled(mine)) return null;
      apply(next);
      ms = host.renderTimed();
      scale = next;
      next = scale === 1 ? null : nextScale(scale, ms, budget);
    }
    return { scale, ms };
  }

  async function refine(mine: number) {
    // em animação não refina: o fim dela volta a disparar
    if (cancelled(mine)) return;
    inLadder = true;
    try {
      const reached = await climb(mine, measureCoarse());
      if (reached) settle(reached.scale, reached.ms);
    } finally {
      inLadder = false;
      if (mine === job) status.refining = false;
    }
  }

  /** Quadro total logo após a sondagem que o previu rápido. */
  function finishNow(mine: number) {
    if (cancelled(mine)) return;
    inLadder = true;
    try {
      apply(1);
      const ms = host.renderTimed();
      settle(1, ms);
    } finally {
      inLadder = false;
      status.refining = false;
    }
  }

  function schedule() {
    job += 1;
    const mine = job;
    if (timer !== null) host.clearTimer(timer);
    status.refining = true;
    timer = host.setTimer(() => {
      timer = null;
      refine(mine);
    }, settleDelay);
  }

  return {
    beforeRender() {
      timeExternal = false;
      if (disposed || inLadder) return;
      if (host.isAnimating()) {
        // primeiro quadro de uma interação: sem medida própria, vale a do
        // quadro parado (mais caro, portanto do lado seguro)
        const known = interactiveFullMs || stillFullMs;
        animationScale = known
          ? interactionScale(known)
          : interactionScale(INTERACTIVE_FRAME_MS * LADDER[1]);
        host.setInteractionScale(animationScale);
        timeExternal = true;
        return;
      }
      animationFrames = 0;
      const signature = host.signature();
      if (signature === settledSignature) return;

      // estado novo: este quadro sai no degrau mais grosso e serve de sonda;
      // o tempo dele decide, em afterExternalRender, o que vem depois
      job += 1;
      if (timer !== null) host.clearTimer(timer);
      timer = null;
      apply(LADDER[0]);
      status.refining = true;
      timeExternal = true;
    },

    afterExternalRender(ms: number) {
      timeExternal = false;
      if (disposed) return;
      if (host.isAnimating()) {
        const full = ms * animationScale;
        animationFrames += 1;
        // o primeiro quadro de cada interação substitui a estimativa herdada;
        // os seguintes suavizam, subindo mais depressa do que descem
        if (!interactiveFullMs || animationFrames === 1)
          interactiveFullMs = full;
        else {
          const weight = full > interactiveFullMs ? 0.6 : 0.25;
          interactiveFullMs += (full - interactiveFullMs) * weight;
        }
        return;
      }
      const mine = job;
      if (predictFull(LADDER[0], ms) <= fast) {
        // rápido: o quadro total sai antes de a tela mostrar a sonda
        host.afterCurrentRender(() => finishNow(mine));
        return;
      }
      // custo alto ou ainda desconhecido (shader novo): refina em etapas
      // quando as mudanças pararem
      schedule();
    },

    wantsTiming: () => timeExternal,

    dispose() {
      disposed = true;
      job += 1;
      if (timer !== null) host.clearTimer(timer);
      timer = null;
    },
  };
}
