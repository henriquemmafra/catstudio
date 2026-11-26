# CatStudio — Cinematic Anatomical Tomography Studio

Visualizador de tomografia com MPR e reconstrução 3D cinematográfica que roda
**inteiramente no navegador**: você abre a pasta do exame, e a leitura
DICOM, a montagem do volume e as reconstruções acontecem no seu computador.
Nada é enviado para servidor.

**Abrir:** https://henriquemmafra.github.io/catstudio/

> Uso em pesquisa e ensino. Não é dispositivo médico e não deve ser usado
> para diagnóstico.

Construído sobre o [VolView](https://github.com/Kitware/VolView) (Kitware,
Apache 2.0), que é a versão web do mesmo ecossistema do 3D Slicer (vtk.js +
itk-wasm). A versão anterior, com o núcleo do 3D Slicer num servidor local,
está no branch [`servidor-slicer`](https://github.com/henriquemmafra/catstudio/tree/servidor-slicer).

## Como usar

1. Abra o link no Chrome ou Edge atualizados (testado no Chrome; precisa de
   WebGL2).
2. **Abrir pasta do exame** (subpastas e arquivos sem extensão entram) ou
   **Abrir arquivos** (aceita .zip); também dá para arrastar e soltar.
3. Em exame grande aparece a lista **Quais séries carregar?**, com tamanho,
   espessura e plano de cada uma e a sugerida já marcada (cortes finos,
   axial, com contraste). Só as marcadas entram; depois, na lateral, é só
   clicar para trocar de série. O layout padrão tem axial, coronal, sagital
   e 3D.
4. **Janela e nível** (ícone de meio círculo): Pulmão, Mediastino, Partes
   moles, Osso, Cérebro, Vias aéreas, janelas do próprio DICOM, automático
   ou manual.
5. **Renderização → Renderização 3D**: presets (Osso, Esqueleto, Tórax com
   contraste, Artérias pulmonares, Coronárias, Pulmão, Vias aéreas, MIP…),
   editor de opacidade/cor e **Renderização cinematográfica** (qualidade,
   oclusão ambiente, espalhamento, luz). No alto do painel, **Desempenho do
   3D**: Leve (padrão sem placa de vídeo dedicada), Equilibrado ou Máximo.
6. No canto da vista 3D: recentralizar câmera e **exportar PNG** (só a
   imagem, sem textos nem dados do paciente).
7. Recorte (ícone de crop), régua, cursor cruzado, layout oblíquo para MPR
   livre, segmentação e "Salvar sessão" (arquivo local).
8. Avisos de geometria (tilt, lacuna, série dividida) aparecem no sino.

### Atalhos de leitura

| Tecla | O que faz |
|---|---|
| `1` a `6` | Janela: Pulmão, Mediastino, Partes moles, Osso, Cérebro, Vias aéreas (vale para as três vistas 2D) |
| `D` | Régua |
| `M` | MIP em espessura na vista ativa (aperte de novo para voltar ao corte fino) |
| `N` | MinIP em espessura na vista ativa |
| `X` | Resetar: recentraliza as câmeras, volta a janela ao padrão e desliga MIP/MinIP |
| `L` `Z` `H` `C` | Janela/nível, zoom, mover, cursor cruzado |
| `?` | Lista completa |

Com MIP/MinIP ligado aparece no alto da vista o modo e a espessura em mm,
com `−` e `+` para ajustar (MIP começa em 10 mm, MinIP em 5 mm; a última
espessura escolhida é lembrada). Se a vista ativa for a 3D, `M` e `N`
valem para as três vistas 2D. Em relação ao VolView, mudaram: a régua
(era `M`), mover (era `N`, agora `H`) e a seleção de segmento por número
(agora `Alt`+número).

## O que o CatStudio acrescenta ao VolView

- **Geometria DICOM verificada**: gantry inclinado, lacunas e espaçamento
  irregular são reamostrados para uma grade regular, com aviso; aquisições
  repetidas e matrizes diferentes viram volumes separados; cópias exatas
  são ignoradas; Enhanced CT/MR multi-frame usa a posição de cada quadro.
  No VolView original esses casos saíam errados sem aviso (o tilt deslocava
  um marcador do fantoma em 35 mm). Detalhes e números em
  [docs/CATSTUDIO.md](docs/CATSTUDIO.md).
- **Memória**: abre a pasta de um exame completo sem derrubar a aba — só a
  série exibida fica na memória (o VolView original carregava todas e caía
  com ~2000 imagens).
- **Triagem de séries**: em exame grande, você escolhe o que carregar
  antes de qualquer imagem ser lida, e a primeira série aberta é a mais
  adequada ao 3D (o VolView abria a que tinha mais imagens).
- **3D leve**: a vista 3D usa uma cópia reduzida do volume e, no modo Leve,
  o 3D clássico sem sombras; as vistas 2D continuam na resolução original.
  O VolView ligava o cinematográfico completo sobre o volume inteiro.
- **Trava de segurança do 3D**: nenhum quadro 3D sai em resolução total
  sem ter o custo medido. Depois de qualquer mudança (câmera, preset, luz,
  recorte), o quadro começa em 1/64 dos pixels e é refinado em etapas; o
  tempo de cada etapa prevê o da seguinte, e se a previsão passa de 0,7 s
  o refino para ali e a vista avisa "Resolução reduzida para não travar",
  com o tempo estimado do quadro completo naquela placa. Enquanto se gira
  o volume, a resolução é ajustada quadro a quadro para ~45 ms. No VolView
  original, ligar oclusão ambiente ou subir a qualidade numa placa modesta
  enviava um quadro de dezenas de segundos e o navegador parava de
  responder. Detalhes em `src/catstudio/renderGuard.ts`.
- **MIP/MinIP em espessura e atalhos de leitura** nas vistas 2D (tabela
  acima); a projeção é feita na placa de vídeo sobre o volume original.
- **Privacidade**: nome, ID e nascimento do paciente nunca aparecem (viram
  "Paciente 1"); sem telemetria, dados de exemplo ou serviços remotos; o
  teste automatizado falha se a página fizer qualquer requisição externa.
- **Interface em português**, botão "Abrir pasta do exame", janelas de TC
  usuais e exportação PNG da vista 3D.

## O que foi testado

Tudo abaixo foi executado (Linux, Chrome headless com WebGL por software):

- **29 testes ponta a ponta no navegador** (`catstudio-testes/`): upload
  real pelos seletores de arquivo e de pasta, volume lido da aplicação e
  comparado voxel a voxel com um fantoma analítico — axial com pixel
  anisotrópico, implicit VR com sinal, aquisição coronal, oblíqua dupla,
  gantry tilt, espaçamento irregular, lacuna, aquisições repetidas,
  matrizes mistas, Enhanced CT multi-frame com quadros embaralhados, 7
  codecs (JPEG 2000 com/sem sinal, JPEG-LS, RLE, JPEG Lossless, Deflate,
  Big Endian), .zip com vários estudos; identificação do paciente ausente
  da página (inclusive no popup de informações DICOM); renderização 3D não
  vazia e PNG exportado; nenhuma requisição externa; e um exame completo
  sintético (7 séries 512×512, ~2000 imagens, 1 GB) aberto pela pasta sem
  derrubar a aba, com só a série exibida na memória e a anterior liberada
  ao trocar de série; nesse mesmo exame, a lista de séries com a sugerida
  marcada, carregar só a escolhida, cancelar, e a vista 3D não vazia com o
  volume reduzido; atalhos de janela, régua e reset; MIP mostrando um
  objeto fora do corte e MinIP apagando um objeto denso dentro da fatia;
  e a trava do 3D nos modos Leve e Máximo: girando o volume e trocando 15
  vezes seguidas os ajustes cinematográficos, nenhuma tarefa da página
  passou de 0,9 s (sem a trava, no mesmo teste, o quadro levava de 3,3 a
  3,7 s).
- **Testes unitários**: 16 da trava de segurança do 3D (com placas
  simuladas de 10 ms a 40 s por quadro), 9 do MIP/MinIP, 12 da triagem de
  séries e do desempenho do 3D
  (sugestão, redução por média de blocos na mesma posição do espaço) e 9
  do módulo de geometria (campo linear reproduzido
  exatamente após reamostrar tilt, lacuna, irregular e quadros fora de
  ordem; liberação de memória) dentro da suíte completa do projeto (2460
  passam; 1 falha só porque baixa um arquivo de data.kitware.com, sem
  acesso à internet no ambiente de teste).
- **Não testado**: Windows/macOS reais, GPUs reais, exames clínicos reais
  (só fantomas sintéticos), Safari. A trava do 3D foi medida com WebGL por
  software, que é lento como uma placa fraca mas não é uma placa real: o
  tempo de compilação de shader no Windows (ANGLE/Direct3D), que também
  pode prender a página por alguns segundos na primeira vez que um ajuste
  cinematográfico é ligado, não foi medido.

## Rodar localmente

Pré-requisito: [Node.js 22 LTS](https://nodejs.org).

```bash
npm ci
npm run build
npx vite preview --open        # http://localhost:4173
```

No Windows dá para usar `iniciar-local.bat` (instala, gera e abre; não foi
executado em Windows). Para desenvolver: `npm run dev`.

Testes:

```bash
npx vitest run src/catstudio                     # unitários do CatStudio
pip install -r catstudio-testes/requirements.txt
python3 catstudio-testes/make_fixtures.py        # gera os fantomas DICOM
python3 catstudio-testes/make_exame_grande.py    # opcional: exame de ~1 GB (teste de memória)
python3 -m pytest catstudio-testes -v            # ponta a ponta (usa dist/)
CATSTUDIO_URL=https://henriquemmafra.github.io/catstudio/ python3 -m pytest catstudio-testes
```

## Publicação

Cada push no `main` roda `.github/workflows/pages.yml`, que gera o build e
publica no branch `gh-pages` (GitHub Pages). O site é estático: o GitHub
só entrega os arquivos da aplicação; os exames nunca passam por ele.

## Licença e créditos

- CatStudio: alterações e arquivos novos © 2026 Henrique Martins dos Santos
  Filho; licença das alterações a definir pelo autor. O código herdado do
  VolView continua sob Apache 2.0, e [NOTICE](NOTICE) lista os arquivos
  alterados, como a licença exige.
- VolView © Kitware, Inc., Apache 2.0 — [LICENSE](LICENSE). README original
  em [README.VolView.md](README.VolView.md).
- vtk.js (BSD-3-Clause), itk-wasm (Apache 2.0) e demais dependências sob as
  próprias licenças (`package-lock.json`).
