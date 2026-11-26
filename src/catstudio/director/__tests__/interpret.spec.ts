import { describe, expect, it } from 'vitest';
import { interpret, normalize } from '@/src/catstudio/director/interpret';
import { defaultRecipe, type Recipe } from '@/src/catstudio/director/recipe';

const ask = (text: string, current: Recipe | null = null, lateral = 1) =>
  interpret(text, current, lateral);

describe('diretor: interpretador local', () => {
  it('o pedido de exemplo do usuário', () => {
    const { recipe, understood, notes } = ask(
      'corte no plano sagital linha hemiclavicular esquerda pra mostrar as estruturas torácicas e hérnia abdominal'
    );
    expect(understood).toBe(true);
    expect(notes).toEqual([]);
    expect(recipe).toMatchObject({
      plano: 'sagital',
      referencia: 'hemiclavicular-esquerda',
      deslocamento: 0,
      projecao: 'fina',
      janela: 'partes-moles',
      campo: 'tudo',
    });
  });

  it('ignora acentos, maiúsculas e espaços', () => {
    expect(normalize('  Hérnia   ABDOMINAL ')).toBe('hernia abdominal');
    expect(
      ask('SAGITAL na Linha Médio-Clavicular DIREITA').recipe
    ).toMatchObject({
      plano: 'sagital',
      referencia: 'hemiclavicular-direita',
    });
  });

  it('a referência decide o plano quando ele não é dito', () => {
    expect(ask('hemiclavicular direita').recipe.plano).toBe('sagital');
    expect(ask('na linha axilar média').recipe).toMatchObject({
      plano: 'coronal',
      referencia: 'axilar-media',
    });
    expect(ask('no ápice pulmonar').recipe).toMatchObject({
      plano: 'axial',
      referencia: 'apice-pulmonar',
    });
  });

  it('"linha média" é referência, não projeção média', () => {
    const { recipe } = ask('sagital na linha média');
    expect(recipe.referencia).toBe('linha-media');
    expect(recipe.projecao).toBe('fina');
  });

  it('"ápice pulmonar" não puxa janela de pulmão', () => {
    expect(ask('axial no ápice pulmonar').recipe.janela).toBe('partes-moles');
    expect(ask('axial no ápice pulmonar, janela de pulmão').recipe.janela).toBe(
      'pulmao'
    );
  });

  it('sem o lado, usa a esquerda e avisa', () => {
    const { recipe, notes } = ask('sagital na hemiclavicular');
    expect(recipe.referencia).toBe('hemiclavicular-esquerda');
    expect(notes[0]).toMatch(/não disse o lado/);
  });

  it('projeção e espessura', () => {
    expect(ask('coronal mip de 20 mm').recipe).toMatchObject({
      plano: 'coronal',
      projecao: 'mip',
      espessura: 20,
    });
    expect(ask('axial MinIP 1,5 cm janela de pulmão').recipe).toMatchObject({
      projecao: 'minip',
      espessura: 15,
      janela: 'pulmao',
    });
    // só a espessura: vira fatia espessa em média
    expect(ask('sagital com 8 mm de espessura').recipe).toMatchObject({
      projecao: 'media',
      espessura: 8,
    });
    expect(ask('coronal fatia espessa').recipe.projecao).toBe('media');
  });

  it('a janela sugerida segue o que se quer mostrar', () => {
    expect(ask('coronal para ver a aorta').recipe.janela).toBe('angio');
    expect(ask('axial para mostrar o enfisema').recipe.janela).toBe('pulmao');
    expect(ask('sagital para ver a coluna').recipe.janela).toBe('osso');
    expect(ask('coronal do tórax').recipe.janela).toBe('mediastino');
  });

  describe('ajustes de uma imagem já feita', () => {
    const current: Recipe = {
      ...defaultRecipe(),
      plano: 'sagital',
      referencia: 'hemiclavicular-esquerda',
      janela: 'partes-moles',
    };

    it('"2 cm mais lateral" afasta da linha média, do lado do corte', () => {
      expect(ask('2 cm mais lateral', current).recipe).toMatchObject({
        plano: 'sagital',
        referencia: 'hemiclavicular-esquerda',
        deslocamento: 20,
      });
      const right = {
        ...current,
        referencia: 'hemiclavicular-direita' as const,
      };
      expect(ask('2 cm mais lateral', right).recipe.deslocamento).toBe(-20);
      expect(ask('15 mm medial', right).recipe.deslocamento).toBe(15);
    });

    it('num ponto marcado, "lateral" depende de que lado o corte está', () => {
      const point = { ...current, referencia: 'ponto' as const, ponto: -60 };
      expect(ask('1 cm mais lateral', point, -1).recipe.deslocamento).toBe(-10);
      expect(ask('1 cm mais lateral', point, 1).recipe.deslocamento).toBe(10);
    });

    it('os ajustes se somam e esquerda/direita são do paciente', () => {
      const moved = ask('1 cm para a esquerda', current).recipe;
      expect(moved.deslocamento).toBe(10);
      expect(ask('5 mm para a direita', moved).recipe.deslocamento).toBe(5);
    });

    it('sem número: "mais", "um pouco mais" e "bem mais"', () => {
      expect(ask('mais lateral', current).recipe.deslocamento).toBe(10);
      expect(ask('um pouco mais medial', current).recipe.deslocamento).toBe(-5);
      expect(ask('bem mais lateral', current).recipe.deslocamento).toBe(30);
    });

    it('direção que não vale para o plano é recusada com aviso', () => {
      const { recipe, notes, understood } = ask('2 cm acima', current);
      expect(recipe.deslocamento).toBe(0);
      expect(notes[0]).toMatch(/não se aplica a um corte sagital/);
      expect(understood).toBe(false);
    });

    it('coronal e axial têm os seus sentidos', () => {
      const coronal = { ...defaultRecipe(), plano: 'coronal' as const };
      expect(ask('3 cm mais anterior', coronal).recipe.deslocamento).toBe(-30);
      expect(ask('3 cm para trás', coronal).recipe.deslocamento).toBe(30);
      const axial = { ...defaultRecipe(), plano: 'axial' as const };
      expect(ask('4 cm abaixo', axial).recipe.deslocamento).toBe(-40);
      expect(ask('1 cm mais cranial', axial).recipe.deslocamento).toBe(10);
    });

    it('trocar só a janela, a projeção ou o fundo mantém o resto', () => {
      expect(ask('janela de osso', current).recipe).toEqual({
        ...current,
        janela: 'osso',
      });
      expect(ask('mip de 30 mm', current).recipe).toEqual({
        ...current,
        projecao: 'mip',
        espessura: 30,
      });
      expect(ask('fundo branco', current).recipe.fundo).toBe('#ffffff');
      expect(ask('só o tórax', current).recipe.campo).toBe('torax');
    });

    it('"mais espesso" e "mais fino"', () => {
      const thick = ask('mais espesso', current).recipe;
      expect(thick).toMatchObject({ projecao: 'media', espessura: 10 });
      expect(ask('mais espesso', thick).recipe.espessura).toBe(20);
      expect(ask('mais fino', thick).recipe.espessura).toBe(5);
      expect(ask('corte fino', thick).recipe.projecao).toBe('fina');
    });

    it('trocar a referência zera o deslocamento', () => {
      const moved = { ...current, deslocamento: 25 };
      expect(
        ask('agora na hemiclavicular direita', moved).recipe
      ).toMatchObject({
        referencia: 'hemiclavicular-direita',
        deslocamento: 0,
      });
    });

    it('um plano novo começa uma imagem nova, mantendo o fundo', () => {
      const white = { ...current, fundo: '#ffffff', projecao: 'mip' as const };
      expect(ask('agora coronal', white).recipe).toEqual({
        ...defaultRecipe(),
        plano: 'coronal',
        fundo: '#ffffff',
      });
    });

    it('um ajuste não troca a janela por causa de uma palavra solta', () => {
      // "pulmão" aqui é só contexto; a janela muda quando é pedida
      expect(
        ask('1 cm mais lateral para pegar o pulmão', current).recipe.janela
      ).toBe('partes-moles');
    });
  });

  it('pedido sem nada reconhecível avisa e não inventa', () => {
    const { recipe, understood, notes } = ask('faz aquela imagem bonita');
    expect(understood).toBe(false);
    expect(notes[0]).toMatch(/Não entendi/);
    expect(recipe).toEqual(defaultRecipe());
  });

  it('referência que não cabe no plano dito cai no centro, com aviso', () => {
    const { recipe, notes } = ask('axial na linha hemiclavicular esquerda');
    expect(recipe).toMatchObject({ plano: 'axial', referencia: 'centro' });
    expect(notes.join(' ')).toMatch(/não se aplica a um corte axial/);
  });
});
