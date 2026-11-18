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
3. Na lateral, escolha a série. O layout padrão tem axial, coronal, sagital
   e 3D.
4. **Janela e nível** (ícone de meio círculo): Pulmão, Mediastino, Partes
   moles, Osso, Cérebro, Vias aéreas, janelas do próprio DICOM, automático
   ou manual.
5. **Renderização → Renderização 3D**: presets (Osso, Esqueleto, Tórax com
   contraste, Artérias pulmonares, Coronárias, Pulmão, Vias aéreas, MIP…),
   editor de opacidade/cor e **Renderização cinematográfica** (qualidade,
   oclusão ambiente, espalhamento, luz).
6. No canto da vista 3D: recentralizar câmera e **exportar PNG** (só a
   imagem, sem textos nem dados do paciente).
7. Recorte (ícone de crop), régua, cursor cruzado, layout oblíquo para MPR
   livre, segmentação e "Salvar sessão" (arquivo local).
8. Avisos de geometria (tilt, lacuna, série dividida) aparecem no sino.

## Ostium — laudo coronário

O botão **Laudo coronário** (barra superior) abre o Ostium sobre as imagens:
pré-laudo de angio-TC de coronárias e escore de cálcio, com texto puro pronto
para colar no sistema de laudos.

- **Escore de cálcio na imagem**: selecione no CatStudio a série do escore
  (sem contraste, 3 mm) e clique em **Ler série aberta**. Os focos ≥ 130 UH
  aparecem realçados; escolha o vaso (teclas 1–4) e clique no foco (pega o
  foco inteiro) ou arraste para contornar só uma parte (laço). Ctrl+Z desfaz.
  Agatston por vaso, CAC-DRS e percentil MESA entram no laudo na hora. Osso
  não vira candidato; nada conta até ser atribuído a um vaso.
- **Mapa coronário** em 3D e planificado: clique no ponto do vaso onde está
  a placa; o segmento citado no laudo é deduzido da posição. É um mapa
  esquemático, não a anatomia do paciente.
- **Laudo ao vivo**: só o que foi marcado entra no texto; passar o mouse
  numa frase destaca o achado de origem.

Limites atuais: o vaso de cada foco de cálcio é escolhido por você (ainda sem
sugestão automática); o percentil MESA usa uma tabela provisória, a validar
contra a calculadora oficial; a árvore coronária ainda não é extraída do
exame. Testes: `python3 catstudio-testes/make_calcio.py` gera o fantoma e
`test_ostium.py` confere o Agatston contra o valor analítico; os 32 testes
unitários do cálculo e do texto ficam em `src/ostium/core/__tests__`.

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
- **Privacidade**: nome, ID e nascimento do paciente nunca aparecem (viram
  "Paciente 1"); sem telemetria, dados de exemplo ou serviços remotos; o
  teste automatizado falha se a página fizer qualquer requisição externa.
- **Interface em português**, botão "Abrir pasta do exame", janelas de TC
  usuais e exportação PNG da vista 3D.

## O que foi testado

Tudo abaixo foi executado (Linux, Chrome headless com WebGL por software):

- **22 testes ponta a ponta no navegador** (`catstudio-testes/`): upload
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
  ao trocar de série.
- **Testes unitários**: 9 do módulo de geometria (campo linear reproduzido
  exatamente após reamostrar tilt, lacuna, irregular e quadros fora de
  ordem; liberação de memória) dentro da suíte completa do projeto (2448
  passam; 1 falha só porque baixa um arquivo de data.kitware.com, sem
  acesso à internet no ambiente de teste).
- **Não testado**: Windows/macOS reais, GPUs reais, exames clínicos reais
  (só fantomas sintéticos), Safari.

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
python3 catstudio-testes/make_calcio.py          # fantoma do escore de cálcio (rode depois do make_fixtures, que recria .data)
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
