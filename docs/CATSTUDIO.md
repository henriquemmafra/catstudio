# CatStudio — arquitetura e decisões

## Por que VolView e não o 3D Slicer

O 3D Slicer é uma aplicação desktop (C++/Qt/VTK + Python) e não roda dentro
de um navegador. A versão anterior do CatStudio (branch `servidor-slicer`)
usava o núcleo do Slicer num servidor Python e transmitia imagens para a
página — os exames passavam por um processo fora do navegador.

O objetivo agora é outro: **upload e reconstrução inteiramente no
navegador**. O ecossistema da Kitware tem a versão web do mesmo motor:

| Slicer (desktop)          | Equivalente no navegador            |
| ------------------------- | ----------------------------------- |
| VTK (C++)                 | vtk.js (WebGL2)                     |
| ITK / GDCM / DCMTK        | itk-wasm (WebAssembly)              |
| Aplicação Qt              | VolView (Vue 3 + Vuetify + Pinia)   |
| Presets de volume (XML)   | Os mesmos presets (ParaView/Slicer) |

O VolView já entrega leitura DICOM no cliente (incluindo JPEG 2000, JPEG-LS,
RLE, JPEG Lossless, Deflate e Big Endian), MPR, oblíquo, renderização
volumétrica cinematográfica (oclusão ambiente, espalhamento), recorte,
medidas, segmentação e sessão salva — tudo sem servidor. Licença Apache 2.0.
Reescrever isso seria refazer um motor gráfico; o CatStudio é um fork com
mudanças pequenas e localizadas.

## O que o CatStudio muda

### 1. Geometria DICOM (`src/catstudio/geometry.ts`, `resampler.ts`, `enhanced.ts`)

Antes de construir em cima, a bateria de fantomas sintéticos da versão
Slicer foi rodada no VolView original (upload real em Chrome headless,
geometria lida da store e comparada voxel a voxel com o fantoma analítico):

Desvio do centróide de uma esfera de 1000 HU em relação à posição real, e
fração de voxels com erro > 100 HU (8000 voxels sorteados):

| Caso                              | VolView original                       | CatStudio                          |
| --------------------------------- | -------------------------------------- | ---------------------------------- |
| Axial, coronal, oblíquo, 8 codecs | 0,00 mm · 0%                           | 0,00 mm · 0% (caminho original)    |
| Gantry tilt 15°                   | **35,1 mm** · 30,2%                    | 0,13 mm · 0%                       |
| Espaçamento irregular 2/3 mm      | 0,26 mm · 0,01% (cortes até 0,5 mm fora) | 0,16 mm · 0% (grade de 2 mm)     |
| Lacuna de 10 mm                   | **2,34 mm** · 0,8%                     | 0,00 mm · 0% + aviso               |
| Aquisição repetida + cópia exata  | **44,4 mm** · 10,3% (87 cortes num volume) | 0,00 mm · 0% (2 volumes: 81 + 5) |
| Matrizes diferentes na série      | 17,1% (volume corrompido)              | 0% (2 volumes)                     |
| Enhanced CT multi-frame           | **81,3 mm** · 64,6% (origem 0, 1 mm)   | 0,00 mm · 0%                       |

Como funciona:

- **Agrupamento** (`refineVolumes`, chamado no fim de `splitAndSort` em
  `src/io/dicom.ts`): depois do agrupamento por série do VolView (feito em
  WebAssembly), cada grupo é dividido por matriz/orientação/tamanho de
  pixel; cópias exatas (mesmo SOPInstanceUID) são ignoradas; posições
  repetidas são separadas por AcquisitionNumber e depois por
  TemporalPositionIdentifier; o que sobra repetido é descartado com aviso.
  Cada pilha é ordenada pela projeção do IPP na normal.
- **Plano** (`planStack`): mede o desvio de cada corte em relação ao modelo
  do VolView (primeiro corte + espaçamento constante ao longo da normal). Se
  o desvio ao longo da normal passar de max(0,05 mm; 5% do espaçamento) ou o
  deslocamento no plano passar de max(0,05 mm; 5% do pixel), a pilha é
  reamostrada. Caso contrário, o VolView segue exatamente como era.
- **Grade de saída**: eixos = linha, coluna e normal do IOP (a vista axial
  continua mostrando o plano de aquisição); extensão = união dos cortes;
  espaçamento = o do exame (tilt) ou o menor intervalo regular (irregular).
- **Reamostragem** (`StackResampler`): progressiva, durante o carregamento —
  cada fatia de saída é calculada assim que os dois cortes vizinhos chegam,
  e cada corte de origem é liberado quando deixa de ser necessário. Linear
  ao longo da normal; no plano (tilt) Catmull-Rom limitado ao intervalo dos
  vizinhos (mais nítido que bilinear, sem halos em bordas osso/ar). Regiões
  sem dado recebem −1024 HU.
- **Enhanced multi-frame** (`augmentEnhancedMetadata`, chamado no
  carregador de metadados): lê os Functional Groups com dicom-parser e
  passa a posição de cada quadro para o plano.
- **Avisos** em português na central de mensagens (sino), uma vez por
  volume: gantry inclinado, lacuna (com posições), espaçamento irregular,
  série dividida, aquisições separadas, arquivos repetidos.
- **Fora do escopo**: OCT/oftalmologia, ultrassom e projeções (DX, CR, MG,
  XA…) seguem as regras próprias do VolView.

### 2. Privacidade (`src/catstudio/privacy.ts`)

- Na entrada do banco de dados DICOM do VolView, nome, ID e data de
  nascimento viram "Paciente N" (pseudônimo válido só na aba); StudyID e
  AccessionNumber são apagados. Nenhuma tela, popup ou captura mostra a
  identificação.
- Sem dados de exemplo, DICOMweb, servidor remoto ou telemetria no build
  (as variáveis `VITE_*` correspondentes ficam vazias). Os testes conferem
  que a página não faz nenhuma requisição fora do próprio site.
- Exportação PNG da vista 3D só com o conteúdo renderizado (sem textos).

### 3. Interface

Logo e nome CatStudio; tela inicial com "Abrir pasta do exame" (seletor de
pasta, subpastas incluídas) e "Abrir arquivos"; abas, ferramentas, layouts,
janelas de TC (Pulmão, Mediastino, Partes moles, Osso, Cérebro, Vias aéreas)
e presets de volume com rótulos em português. Os identificadores internos
continuam os do VolView (estado salvo, atalhos e testes não mudam).

## Limitações conhecidas

- As vistas 2D seguem os eixos da aquisição (comportamento do VolView). Em
  aquisição oblíqua ou com tilt, os planos mostrados são os da aquisição;
  para planos anatômicos verdadeiros use o layout "Oblíquo (MPR livre)".
- A reamostragem usa memória extra só para cortes "em trânsito"; um exame
  com tilt e 1000+ cortes de 512×512 continua cabendo, mas o limite real é a
  memória da aba (navegadores de 64 bits costumam aceitar alguns GB).
- WebGL2 é obrigatório. Em máquinas sem GPU dedicada a renderização
  cinematográfica em qualidade alta fica lenta.
- Uso em pesquisa e ensino; não é dispositivo médico.

## Próximos passos (Etapa 2 — Cinematic Rendering)

1. Presets cinematográficos próprios para TC de tórax/cardíaca (curvas de
   opacidade e cor, iluminação), com miniaturas.
2. Controles de luz (direção, intensidade, sombras volumétricas) e câmera
   (órbita animada, exportação em resolução maior que a tela, vídeo).
3. Recorte anatômico rápido (mesa, caixa, plano) e máscaras de remoção.
4. Comparação com o resultado do Vitrea em casos reais anonimizados.
