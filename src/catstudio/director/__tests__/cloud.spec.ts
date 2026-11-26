import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_STORAGE_KEY,
  CloudError,
  askCloud,
  cloudConfig,
  examSummary,
  scrub,
} from '@/src/catstudio/director/cloud';
import { findLandmarks } from '@/src/catstudio/director/landmarks';
import { defaultRecipe } from '@/src/catstudio/director/recipe';
import { axialPhantom } from './phantom';

const landmarks = findLandmarks(axialPhantom(8));
const config = { ia: 'https://exemplo.modal.run', key: 'segredo' };
const request = { text: 'sagital', current: null, landmarks };

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as any;

describe('diretor: nuvem', () => {
  afterEach(() => localStorage.clear());

  it('lê a configuração que o CineDeck guardou', () => {
    expect(cloudConfig()).toBeNull();
    localStorage.setItem(
      CLOUD_STORAGE_KEY,
      JSON.stringify({
        tc: 'https://tc',
        ia: 'https://ia.modal.run/',
        key: 'k',
      })
    );
    expect(cloudConfig()).toEqual({ ia: 'https://ia.modal.run', key: 'k' });
  });

  it('recusa configuração sem IA, sem https ou corrompida', () => {
    localStorage.setItem(
      CLOUD_STORAGE_KEY,
      JSON.stringify({ tc: 'https://tc' })
    );
    expect(cloudConfig()).toBeNull();
    localStorage.setItem(CLOUD_STORAGE_KEY, JSON.stringify({ ia: 'http://x' }));
    expect(cloudConfig()).toBeNull();
    localStorage.setItem(CLOUD_STORAGE_KEY, '{quebrado');
    expect(cloudConfig()).toBeNull();
  });

  it('tira números longos do pedido e limita o tamanho', () => {
    expect(scrub('paciente 12345678, corte sagital 20 mm')).toBe(
      'paciente [número], corte sagital 20 mm'
    );
    expect(scrub('a'.repeat(5000)).length).toBe(600);
  });

  it('só geometria vai para a IA', () => {
    const summary = examSummary(landmarks);
    expect(
      Object.values(summary)
        .flat()
        .every((v) => typeof v !== 'object')
    ).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(300);
  });

  it('envia o pedido com a chave e confere a receita que volta', async () => {
    const fetcher = respond(200, {
      receita: {
        plano: 'sagital',
        referencia: 'hemiclavicular-esquerda',
        janela: 'janela-inventada',
        espessura: 1e9,
      },
      comentario: 'Corte pelo hemitórax esquerdo.',
    });
    const answer = await askCloud(config, request, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://exemplo.modal.run/diretor');
    expect(init.headers['x-cinedeck-key']).toBe('segredo');
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(['atual', 'exame', 'pedido']);
    expect(answer.recipe).toEqual({
      ...defaultRecipe(),
      plano: 'sagital',
      referencia: 'hemiclavicular-esquerda',
      espessura: 150,
    });
    expect(answer.comment).toBe('Corte pelo hemitórax esquerdo.');
  });

  it('diz por que falhou, para cair no interpretador local', async () => {
    const reason = async (fetcher: any) =>
      askCloud(config, request, fetcher).then(
        () => 'ok',
        (error) => (error as CloudError).reason
      );
    expect(await reason(respond(404, {}))).toBe('sem-rota');
    expect(await reason(respond(401, {}))).toBe('chave');
    expect(await reason(respond(500, {}))).toBe('rede');
    expect(await reason(respond(502, {}))).toBe('resposta');
    expect(await reason(respond(200, { comentario: 'sem receita' }))).toBe(
      'resposta'
    );
    expect(
      await reason(
        vi.fn(async () => {
          throw new TypeError('offline');
        })
      )
    ).toBe('rede');
    expect(
      await reason(vi.fn(async () => new Response('<html>', { status: 200 })))
    ).toBe('resposta');
  });
});
