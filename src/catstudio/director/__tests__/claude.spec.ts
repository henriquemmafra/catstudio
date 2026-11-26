import { describe, expect, it, vi } from 'vitest';
import {
  askClaude,
  claudeSample,
  directorPrompt,
} from '@/src/catstudio/director/claude';
import { findLandmarks } from '@/src/catstudio/director/landmarks';
import { defaultRecipe } from '@/src/catstudio/director/recipe';
import { axialPhantom } from './phantom';

const landmarks = findLandmarks(axialPhantom(8));
const request = {
  text: 'sagital na hemiclavicular esquerda, registro 987654321',
  current: null,
  landmarks,
};

describe('diretor: dentro do Claude', () => {
  it('fora do Claude não há a quem perguntar', async () => {
    expect(await claudeSample(undefined)).toBeNull();
    expect(await claudeSample({})).toBeNull();
    expect(await claudeSample({ use: async () => null })).toBeNull();
    expect(
      await claudeSample({
        use: async () => {
          throw new Error('recusado');
        },
      })
    ).toBeNull();
  });

  it('dentro do Claude usa a capacidade "sample"', async () => {
    const sample = { json: vi.fn() };
    const use = vi.fn(async (name: string) =>
      name === 'sample' ? sample : null
    );
    expect(await claudeSample({ use })).toBe(sample);
    expect(use).toHaveBeenCalledWith('sample');
  });

  it('o pedido leva instruções, texto sem números longos e só geometria', () => {
    const prompt = directorPrompt(request);
    expect(prompt).toContain('Responda SOMENTE com JSON');
    expect(prompt).toContain('PEDIDO:\nsagital na hemiclavicular esquerda');
    expect(prompt).not.toContain('987654321');
    expect(prompt).toContain('RECEITA EM USO:\nnull');
    expect(prompt).toContain('"referencias":"pulmoes"');
  });

  it('a receita que volta é conferida', async () => {
    const sample = {
      json: vi.fn(async () => ({
        receita: {
          plano: 'sagital',
          referencia: 'hemiclavicular-esquerda',
          espessura: -5,
        },
        comentario: 'Clique no localizador para passar pela hérnia.',
      })),
    };
    const answer = await askClaude(sample, request);
    expect(answer.recipe).toEqual({
      ...defaultRecipe(),
      plano: 'sagital',
      referencia: 'hemiclavicular-esquerda',
      espessura: 1,
    });
    expect(answer.comment).toMatch(/localizador/);
    expect((sample.json.mock.calls[0] as unknown[])[1]).toMatchObject({
      cache: false,
    });
  });

  it('resposta sem receita ou recusa viram erro, para cair no interpretador local', async () => {
    await expect(
      askClaude({ json: async () => ({ comentario: 'oi' }) }, request)
    ).rejects.toThrow();
    await expect(
      askClaude(
        {
          json: async () => {
            throw Object.assign(new Error('x'), { code: 'not_granted' });
          },
        },
        request
      )
    ).rejects.toThrow();
  });
});
