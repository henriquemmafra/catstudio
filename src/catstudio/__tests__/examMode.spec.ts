import { describe, expect, it } from 'vitest';
import { MODES, detectMode, modeFromText } from '../examMode';
import { WLPresetsCT } from '@/src/constants';
import { PALETTES } from '../palette';

const never = () => false;

describe('modo por tipo de exame', () => {
  it.each([
    ['ANGIOTOMOGRAFIA DE CORONÁRIAS', 'cardio'],
    ['Escore de cálcio', 'cardio'],
    ['TC CORAÇÃO - TAVI', 'cardio'],
    ['ANGIOTOMOGRAFIA DE TÓRAX (TEP)', 'angio'],
    ['Angio-TC de aorta total', 'angio'],
    ['TC DE TÓRAX ALTA RESOLUÇÃO', 'torax'],
    ['CHEST 1.0 B70f', 'torax'],
    ['TC ABDOME TOTAL', 'abdome'],
    ['Uro-TC', 'abdome'],
  ])('%s → %s', (text, mode) => {
    expect(modeFromText(text)?.mode).toBe(mode);
  });

  it('sem pista no texto, não inventa', () => {
    expect(modeFromText('Fase arterial 1 mm')).toBeNull();
    expect(modeFromText('')).toBeNull();
  });

  it('a descrição ganha dos pulmões; sem descrição, pulmões = tórax', () => {
    const abdomen = detectMode({
      texts: ['', 'TC ABDOME'],
      hasLungs: () => true,
    });
    expect(abdomen.mode).toBe('abdome');
    expect(abdomen.why).toContain('abd');
    expect(detectMode({ texts: ['1 mm'], hasLungs: () => true }).mode).toBe(
      'torax'
    );
    expect(detectMode({ texts: [], hasLungs: never }).mode).toBe('livre');
  });

  it('as janelas e paletas dos modos existem', () => {
    Object.values(MODES).forEach((spec) => {
      if (spec.window) expect(Object.keys(WLPresetsCT)).toContain(spec.window);
      if (spec.palette)
        expect(PALETTES.map((p) => p.id)).toContain(spec.palette);
    });
  });
});
