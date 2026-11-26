import { describe, it, expect } from 'vitest';
import {
  createRenderGuard,
  nextScale,
  predictFull,
  FRAME_BUDGET_MS,
  INTERACTIVE_FRAME_MS,
  MAX_INTERACTION_SCALE,
  interactionScale,
  LADDER,
  type GuardHost,
  type GuardStatus,
} from '@/src/catstudio/renderGuard';

/**
 * Placa simulada: `fullMs` é o tempo do quadro em resolução total. `frame()`
 * imita um quadro pedido de fora (o vtk.js chama o guarda antes e depois).
 */
function fakeHost(initialFullMs: number) {
  const log: number[] = [];
  let fullMs = initialFullMs;
  let scale = 1;
  let interaction = 0;
  let signature = 'a';
  let animating = false;
  const timers: Array<() => void> = [];
  const pending: Array<() => void> = [];
  const draw = () => {
    const used = animating ? interaction || 1 : scale;
    log.push(used);
    return fullMs / used;
  };
  const host: GuardHost = {
    isAnimating: () => animating,
    signature: () => signature,
    setScale: (s) => {
      scale = s;
    },
    setInteractionScale: (s) => {
      interaction = s;
    },
    renderTimed: draw,
    afterCurrentRender: (fn) => {
      pending.push(fn);
    },
    yieldFrame: () => Promise.resolve(),
    now: () => 0,
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: (handle) => {
      timers[(handle as number) - 1] = () => {};
    },
  };
  const status: GuardStatus = {
    scale: 1,
    limited: false,
    refining: false,
    fullEstimateMs: 0,
  };
  const guard = createRenderGuard(host, status);
  return {
    status,
    log,
    guard,
    /** quadro pedido de fora; devolve o tempo que levou */
    frame() {
      guard.beforeRender();
      const ms = draw();
      if (guard.wantsTiming()) guard.afterExternalRender(ms);
      while (pending.length) pending.shift()!();
      return ms;
    },
    change: (s: string) => {
      signature = s;
    },
    setFullMs: (ms: number) => {
      fullMs = ms;
    },
    setAnimating: (v: boolean) => {
      animating = v;
    },
    scale: () => scale,
    interaction: () => interaction,
    /** pior quadro até aqui, em ms, com o custo atual */
    worst: () => Math.max(...log.map((used) => fullMs / used)),
    async runTimers() {
      while (timers.length) timers.shift()!();
      // deixa as etapas assíncronas do refino terminarem
      for (let i = 0; i < 30; i++) await Promise.resolve();
    },
  };
}

describe('renderGuard: escolha da próxima etapa', () => {
  it('pula direto para a resolução total quando ela cabe no limite', () => {
    expect(nextScale(64, 1)).toBe(1);
  });

  it('escolhe a etapa mais fina que cabe', () => {
    // 64x menos pixels levou 40 ms: total 2560 ms, 1/4 = 640 ms
    expect(nextScale(64, 40)).toBe(4);
    expect(nextScale(4, 640)).toBeNull();
    // 1/4 dos pixels em 300 ms: 2/3 da largura (533 ms) cabe, o total não
    expect(nextScale(4, 300)).toBe(2.25);
  });

  it('não avança quando nem a etapa seguinte cabe', () => {
    expect(nextScale(64, FRAME_BUDGET_MS)).toBeNull();
  });

  it('prevê o quadro total pela proporção de pixels', () => {
    expect(predictFull(16, 100)).toBe(1600);
  });
});

describe('renderGuard: refino', () => {
  it('placa rápida: o quadro total sai logo após a sonda, sem esperar', () => {
    const t = fakeHost(64);
    t.frame();
    expect(t.log).toEqual([LADDER[0], 1]);
    expect(t.status).toMatchObject({
      scale: 1,
      limited: false,
      refining: false,
    });
  });

  it('placa lenta nunca recebe um quadro acima do limite', async () => {
    const t = fakeHost(40_000); // 40 s em resolução total
    t.frame();
    expect(t.scale()).toBe(LADDER[0]);
    expect(t.status.refining).toBe(true);
    await t.runTimers();
    expect(t.worst()).toBeLessThanOrEqual(FRAME_BUDGET_MS);
    expect(t.status.limited).toBe(true);
    expect(t.status.scale).toBeGreaterThan(1);
    expect(t.status.fullEstimateMs).toBeCloseTo(40_000);
  });

  it('placa intermediária para no degrau que cabe', async () => {
    const t = fakeHost(2000);
    t.frame();
    await t.runTimers();
    expect(t.status.scale).toBe(4); // 500 ms
    expect(t.status.limited).toBe(true);
    expect(t.worst()).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });

  it('quadro repetido sem mudança não reinicia o refino', async () => {
    const t = fakeHost(2000);
    t.frame();
    await t.runTimers();
    const renders = t.log.length;
    t.frame();
    await t.runTimers();
    expect(t.log.length).toBe(renders + 1); // só o próprio quadro
    expect(t.status.scale).toBe(4);
  });

  it('mudanças em sequência só refinam depois da última', async () => {
    const t = fakeHost(2000);
    ['b', 'c', 'd'].forEach((s) => {
      t.change(s);
      t.frame();
      expect(t.scale()).toBe(LADDER[0]);
    });
    expect(t.log.every((scale) => scale === LADDER[0])).toBe(true);
    await t.runTimers();
    expect(t.log.filter((scale) => scale === 4).length).toBe(1);
  });

  it('conteúdo que fica pesado de repente não passa em resolução total', async () => {
    // preset esparso e rápido; depois um preset denso, 100 vezes mais caro
    const t = fakeHost(60);
    t.frame();
    expect(t.status.scale).toBe(1);
    t.setFullMs(6000);
    t.change('preset-denso');
    t.log.length = 0;
    t.frame();
    await t.runTimers();
    expect(t.worst()).toBeLessThanOrEqual(FRAME_BUDGET_MS);
    expect(t.status.limited).toBe(true);
  });

  it('volta à resolução total quando o ajuste pesado é desligado', async () => {
    const t = fakeHost(6000);
    t.frame();
    await t.runTimers();
    expect(t.status.limited).toBe(true);
    t.setFullMs(60);
    t.change('oclusao-desligada');
    t.frame();
    expect(t.status).toMatchObject({ scale: 1, limited: false });
  });

  it('durante a animação não refina; só ajusta a resolução de interação', () => {
    const t = fakeHost(2000);
    t.setAnimating(true);
    t.frame();
    expect(t.status.refining).toBe(false);
    expect(t.log.length).toBe(1);
    expect(t.interaction()).toBeGreaterThan(1);
  });

  it('a interação começa reduzida numa placa lenta e fica perto do alvo', async () => {
    const t = fakeHost(4000);
    t.frame();
    await t.runTimers(); // quadro parado medido: 4 s em resolução total
    t.setAnimating(true);
    const times = Array.from({ length: 10 }, () => t.frame());
    // degraus de 25%: no pior caso um quadro passa 12% do alvo
    expect(Math.max(...times)).toBeLessThanOrEqual(INTERACTIVE_FRAME_MS * 1.13);
  });

  it('a primeira interação, sem nenhuma medida, já começa reduzida', () => {
    const t = fakeHost(4000);
    t.setAnimating(true);
    t.frame();
    expect(t.interaction()).toBeGreaterThan(10); // ~1/4 da largura
  });

  it('a interação sobe para resolução total numa placa rápida', () => {
    const t = fakeHost(10);
    t.setAnimating(true);
    for (let frame = 0; frame < 5; frame++) t.frame();
    expect(t.interaction()).toBe(1);
  });

  it('interactionScale arredonda em degraus e respeita os limites', () => {
    expect(interactionScale(0)).toBe(1);
    expect(interactionScale(INTERACTIVE_FRAME_MS)).toBe(1);
    expect(interactionScale(INTERACTIVE_FRAME_MS * 4)).toBeCloseTo(4, 0);
    expect(interactionScale(1e9)).toBeLessThanOrEqual(
      MAX_INTERACTION_SCALE * 1.13
    );
  });
});
