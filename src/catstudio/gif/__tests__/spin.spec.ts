import { describe, expect, it } from 'vitest';
import { vec3 } from 'gl-matrix';
import { FRAMES, gifSize, playOrder, sweep, turned } from '../spin';

const base = {
  position: vec3.fromValues(0, -500, 0),
  focalPoint: vec3.fromValues(0, 0, 0),
  viewUp: vec3.fromValues(0, 0, 1),
};
const near = (a: ArrayLike<number>, b: number[]) =>
  b.forEach((v, i) => expect(a[i]).toBeCloseTo(v, 3));

describe('GIF girando', () => {
  it('a volta inteira não repete o primeiro quadro', () => {
    const a = sweep(360);
    expect(a).toHaveLength(FRAMES[360]);
    expect(a[0]).toBe(0);
    expect(a[a.length - 1]).toBeCloseTo(360 - 360 / FRAMES[360]);
  });

  it('arco parcial fica centrado na vista atual', () => {
    const a = sweep(90);
    expect(a[0]).toBe(-45);
    expect(a[a.length - 1]).toBe(45);
    expect(sweep(180)[0]).toBe(-90);
  });

  it('vaivém volta sem repetir as pontas', () => {
    expect(playOrder(4, 'giro')).toEqual([0, 1, 2, 3]);
    expect(playOrder(4, 'vaivem')).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it('eixo vertical gira de lado, mantendo o "para cima"', () => {
    const p = turned(base, 'vertical', 90);
    expect(Math.abs(p.position[0])).toBeCloseTo(500, 3);
    expect(p.position[1]).toBeCloseTo(0, 3);
    near(p.viewUp, [0, 0, 1]);
    near(turned(base, 'vertical', 360).position, [0, -500, 0]);
  });

  it('eixo horizontal tomba: a câmera sobe e o "para cima" acompanha', () => {
    const p = turned(base, 'horizontal', 90);
    expect(p.position[0]).toBeCloseTo(0, 3);
    expect(Math.abs(p.position[2])).toBeCloseTo(500, 3);
    expect(Math.abs(p.viewUp[1])).toBeCloseTo(1, 3);
    // a distância até o ponto olhado não muda
    expect(vec3.distance(p.position, p.focalPoint)).toBeCloseTo(500, 3);
  });

  it('o GIF nunca aumenta a imagem', () => {
    expect(gifSize(960, 720, 480)).toEqual([480, 360]);
    expect(gifSize(300, 200, 480)).toEqual([300, 200]);
  });
});
