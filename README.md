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

### Camadas do 3D (mostrar/esconder)

O ícone de camadas na vista 3D abre a barra **Separar tecidos**. Depois de
alguns segundos aparecem os botões, um por camada, para mostrar ou esconder:
**Fora do corpo** (mesa, cabos), **Pele** (os primeiros ~3 mm), **Gordura**,
**Músculos e órgãos**, **Vasos (contraste)** e **Osso**. O de vasos só fica
ativo em exame com contraste.

É uma separação por densidade e posição, não segmentação de órgão: "músculos
e órgãos" inclui fígado, coração e tudo de −30 a 150 UH; "vasos" é tudo
acima de 150 UH que não é osso, então inclui cálcio e contraste nos rins e
na bexiga; osso encostado em vaso contrastado pode ir junto com ele.

### Esculpir o 3D

Na vista 3D, a tesoura (canto de cima, à esquerda) abre as ferramentas de
escultura. Nada disso altera o exame nem as vistas 2D: o 3D passa a desenhar
uma cópia em que o que foi apagado vira ar.

- **Borracha** — com o botão esquerdo apertado, apaga a superfície por onde
  o cursor passa (raio ajustável); passar de novo vai mais fundo. O gesto
  inteiro vale um desfazer.
- **Laço: apagar / manter** — contorne com o botão esquerdo; o corte vale para
  toda a profundidade daquela direção de visão (gire e corte de novo para
  esculpir em qualquer ângulo). Depois de cada laço a vista volta a girar.
- **Clique: apagar / manter** — clique numa estrutura (osso, mesa, cabo, vaso)
  e ela some inteira, ou fica só ela. Arrastar continua girando.
- **Tirar fragmentos** — apaga as estruturas soltas menores que o tamanho
  escolhido (a "poeira").
- **Densidade mínima** — o que conta como estrutura; começa no ponto em que o
  preset atual passa a mostrar alguma coisa.
- **Crescer: manter / apagar** — aperte e segure em cima de um vaso: a seleção
  avança ao longo dele enquanto o botão fica apertado (o volume aparece no
  painel). Solte para parar; o gesto inteiro vale um desfazer.
- **Crescer: destacar** — aperte e segure em cima do vaso ou órgão: ele vai
  sendo pintado numa cor de destaque e o resto fica translúcido. Repita para
  somar outros. Dá para trocar a cor, escolher quanto do resto aparece e
  limpar o destaque. (A foto final ainda não reproduz o destaque.)
- **Detectar osso** — marca as estruturas densas e heterogêneas (cortical +
  medular). Depois, o controle **Osso** vai de escondido a normal, passando
  por translúcido. **Osso sim/não** corrige no clique o que a detecção errou.
- **Tirar mesa** — esconde a mesa, o travesseiro, os cabos e todo o ar de
  fora do corpo. O corpo é a maior estrutura de tecido do exame; o ar de
  dentro (pulmões, traqueia, alças) fica. Marque "sempre, ao abrir" para isso
  acontecer sozinho em todo exame (a escolha fica guardada no navegador).
- **Desfazer** (12 níveis) e **Restaurar tudo**.

**Só pulmões**: em Ferramentas 3D, um clique esconde tudo menos os pulmões
(com os vasos e brônquios de dentro) e põe as cores de pulmão do diretor de
arte. Desfazer traz o resto de volta.

**Modo do exame** (tórax, angio, coronária/cardíaco, abdome, livre): botão na
barra lateral. Ao abrir, o programa detecta o tipo pela descrição do estudo e
da série (lidas no navegador) e, se elas não dizem nada, pelos pulmões; o menu
mostra por que escolheu. O modo põe a janela dos cortes (pulmão, angio, partes
moles), as cores do 3D e deixa à mão só as ferramentas do caso; o resto fica
em "Mais ferramentas" no mesmo menu. Dá para trocar o modo, detectar de novo
ou desligar a detecção. Janela nova no menu de janelas: Angio (L 200, W 800).

**Volume de cavidade (VE, VD)**: botão do coração meio cheio na barra
lateral. Ponha o cruzamento dos três cortes dentro da cavidade contrastada,
risque com a régua o plano valvar e a via de saída (cada régua vira uma parede
que o crescimento não atravessa) e clique em "Medir VE" ou "Medir VD". Sai o
volume em mL (e por m², com altura e peso), a cavidade fica pintada nos cortes
para conferir e o limiar tem um controle. Conta só o sangue acima do limiar
(papilares e trabéculas ficam de fora), na resolução cheia do exame, e é o
volume da fase aberta. Passou de 700 mL, avisa que vazou.

**Só coração**: ao lado de "Só pulmões". Procura o maior bloco de partes
moles entre os dois pulmões; vem junto a raiz dos grandes vasos e, embaixo,
pode vir uma fatia do fígado. É ponto de partida para acertar com a borracha.

**Osso no tórax**: com os pulmões achados, o que é denso na parede (costela,
esterno, escápula, clavícula) conta como osso mesmo fino e em volume reduzido;
e a coluna encostada num vaso contrastado é separada dele quando o contato é
fino. Contraste denso na veia do braço/subclávia pode entrar como osso: o
clique "Osso sim/não" corrige.

**GIF do 3D girando**: Exportar > "GIF girando…". Giro (um sentido) ou vaivém,
90, 180 ou 360°, eixo vertical (gira de lado, o padrão) ou horizontal (tomba);
tamanho e velocidade à escolha. Nos arcos de 90° e 180° a vista atual fica no
meio do movimento.

**Apagado e destaque nos cortes 2D**: o que a borracha, o laço e o crescer
apagam no 3D aparece em azul nos cortes, e o destaque aparece na cor dele,
para conferir onde a ferramenta pegou. Liga e desliga em Ferramentas 3D
("mostrar nos cortes 2D"). Ar apagado (fora do corpo) não é pintado.

**Passar os cortes com o botão direito**: nas vistas 2D, segure o botão
direito e arraste para cima ou para baixo (a altura da vista percorre o exame
todo). O zoom com o direito passou para Ctrl + direito; a roda continua igual.

**Janela do 3D com os dois botões do mouse**: com o esquerdo e o direito
apertados juntos, arrastar para cima/baixo anda a curva de opacidade para
tecidos menos/mais densos, e para a direita/esquerda deixa mais/menos opaco.
Vale para os presets de TC (curva de pontos).

Tirar mesa também é heurística e só foi testada em fantoma: corta contatos
de até 2 voxels entre corpo e mesa (roupa, lençol); um braço ao lado do corpo
sem encostar nele sai junto com a mesa; desfaça se errar.

**Girar a caixa de corte**: com a ferramenta de recorte ligada, aparecem no
alto da vista 3D: **De frente para a tela** (gire o exame até o ângulo que
quiser e clique — a caixa fica de frente para a tela e o corte, paralelo a
ela), ↺ ↻ (15° em torno da linha de visão) e **Ctrl + arrastar** (gira a
caixa sem precisar ligar nada). Também há "Girar caixa". Marcado, arrastar com o botão esquerdo
gira a caixa em torno do centro do exame (o exame e a câmera ficam parados);
as alças continuam funcionando na caixa girada. "Alinhar" volta ao exame. A
rotação vale só no 3D: as linhas de corte das vistas 2D continuam mostrando a
caixa alinhada, e ela não entra na sessão salva.

A detecção de osso é uma heurística, não uma segmentação validada: vaso
contrastado encostado em osso sai junto, osso muito pouco denso pode ficar de
fora, e ela só foi testada em fantoma. Osso translúcido dobra o que a placa de
vídeo carrega (dois componentes por voxel); escondido e normal não custam nada.

Limites: a escultura é feita no volume que o 3D desenha (reduzido nos modos
Leve e Equilibrado) e recomeça se o modo de desempenho mudar; estruturas que se
tocam (osso encostado em vaso contrastado) saem juntas no clique — separe antes
com o laço; ainda não entra na sessão salva.

### Cores por tecido

**Renderização → Cores por tecido** troca a curva crua do VolView por uma
lista de pontos com nome: a partir de tal densidade (HU), tal cor e tal
opacidade; entre dois pontos a mudança é gradual.

- Sete paletas prontas: Natural, Vascular, Osso marfim, Músculo e osso,
  Pulmão e vias aéreas, Vidro azul, Metal e stents.
- Cada ponto tem cor, nome, densidade em HU e opacidade, editáveis; a vista
  3D acompanha na hora. Dá para acrescentar e tirar pontos.
- **Salvar** guarda a paleta com o seu nome (fica no navegador).
- No 3D, os dois botões do mouse juntos deslocam a paleta inteira (para
  cima/baixo, 2 HU por pixel) e mudam a opacidade (para os lados).

Os presets de cor do VolView continuam lá; escolher um deles tira a paleta.
As paletas prontas foram desenhadas pelos valores típicos de TC e só foram
vistas em fantoma: os pontos provavelmente pedem ajuste no exame real.

### Diretor de arte: andar pelos cortes, paciente girado, só os pulmões

- **Andar sem esperar**: depois do primeiro corte, os vizinhos (de 5 em 5 mm,
  até 10 cm para cada lado) são desenhados sozinhos em segundo plano. O
  controle **Posição**, a roda do mouse em cima do corte e as setas ← → mostram
  os que já estão prontos na hora. No 3D aparece antes um esboço em resolução
  menor enquanto o completo é feito. Andar não entra no "Desfazer".
- **Paciente girado no aparelho**: o diretor mede o giro do paciente em torno
  do eixo do corpo (pela simetria do contorno e das costelas na altura dos
  pulmões) e, por padrão, corta nos eixos do paciente endireitado. O giro
  medido aparece num aviso. "do aparelho" volta aos eixos do tomógrafo;
  "ajustado" volta aos do paciente. Só corrige o giro em torno do eixo do
  corpo (deitado de lado), não a inclinação da cabeça para os pés.
- **Só os pulmões em 3D** ("só o pulmão em 3D", "pulmões isolados", "árvore
  brônquica"): mostra os dois pulmões inteiros, vistos de fora, com o
  parênquima translúcido e os vasos e lesões dentro; o resto do corpo some.
  "mostra tudo" volta. A região do pulmão é a do ar interno, então vasos
  grandes do hilo e lesões coladas na parede podem ficar de fora.

### Diretor de arte → "Editar no 3D"

O botão **Editar no 3D** leva a imagem montada pelo diretor para a vista 3D
comum, como ponto de partida: a câmera olhando do mesmo lado, a caixa de
corte no plano do corte (com a ferramenta de recorte ligada, para ajustar
arrastando), girada junto com o paciente se ele estava torto no aparelho, a
paleta por tecido mais parecida e a cor do fundo. Com "só os pulmões", o resto
do corpo fica escondido pela escultura (dá para desfazer). Daí em diante
valem todas as ferramentas do 3D. Reabrir o diretor no mesmo exame continua
de onde parou.

### Visual do diretor na vista 3D

As cores do diretor de arte viraram paletas da vista 3D (**Diretor: tecidos,
osso, vasos, pulmões**, as primeiras da lista em Cores por tecido), com a
opacidade medida por milímetro, como no diretor. O preset de luz **Diretor**
usa a mesma luz (do observador, do alto e da esquerda, sem brilho) e calcula o
relevo pela opacidade, o que deixa a face do corte lisa, sem o granulado.
"Editar no 3D" já usa os dois.

**Limpar poeira** fica também na barra de camadas e leva em conta o que está
escondido: o que sobra solto depois de esconder os músculos sai como poeira.

### Iluminação, fundo e exportação em alta

- **Renderização → Iluminação e fundo**: presets Estúdio, Dramático, Suave e
  Brilho, com direção, altura e intensidade da luz, e a cor do fundo (preto,
  azul-escuro, cinza, branco ou qualquer outra). Funcionam em qualquer modo de
  desempenho, porque mudam só a luz e o material. "Padrão" devolve a luz da
  câmera.
- **Exportar** (ícone na vista 3D): como está na tela, 2× (slide) ou 4×
  (pôster, até 4096 px no maior lado). A vista é redesenhada maior, capturada
  e volta ao normal. A trava do 3D continua valendo: em placa fraca o quadro
  grande pode sair com resolução interna reduzida em vez de travar.

### Foto final (textura em qualidade máxima)

O 3D na tela é limitado pela placa de vídeo: nos modos Leve e Equilibrado ele
usa o volume reduzido, a trava baixa a resolução quando a placa não aguenta e
o Leve não tem sombra. Daí a textura granulada e borrada.

**Exportar → Foto final** refaz a imagem no processador, raio por raio, no
volume original em resolução total, com as mesmas cores, cortes, caixa girada,
escultura e osso da tela, e acrescenta brilho, luz de preenchimento e sombra
projetada. Como não usa a placa de vídeo, não trava nem derruba as vistas.

- **Foto final**: o dobro do tamanho da vista. Num exame de 512 × 512 × 300,
  uns 5 s aqui; num computador mais antigo, conte 15–30 s.
- **Foto final 4×**: até 4096 px no maior lado, para pôster; alguns minutos.
- O andamento aparece embaixo da vista, com "Cancelar". A página continua
  usável enquanto isso.

A luz é a do preset de iluminação escolhido; no "Padrão", vem de cima e um
pouco da esquerda, para a sombra aparecer. A foto ignora a "opacidade por
gradiente" do modo clássico do VolView: ela mostra exatamente a curva (ou a
paleta) escolhida.

### Tela inicial e vistas pretas

- A casinha no alto da barra de ferramentas fecha o exame e volta à tela
  inicial.
- Se a placa de vídeo derrubar o contexto (todas as vistas pretas e um aviso
  no sino), o CatStudio recria as vistas sozinho. Depois de três quedas num
  minuto ele para e mostra um botão "Tentar de novo".

### Diretor de arte (peça o corte por texto)

Botão de claquete na barra lateral. Você escreve a imagem que quer e o
CatStudio desenha o corte **uma vez**, em CPU, sem redesenhar enquanto se
ajusta e sem usar a placa de vídeo:

> corte no plano sagital, linha hemiclavicular esquerda, para mostrar as
> estruturas torácicas e a hérnia abdominal

- **O que ele entende**: plano (axial, coronal, sagital); onde cortar (linha
  média, hemiclavicular e paraesternal direita/esquerda, axilar média, ápice
  e base pulmonar, centro); corte fino, MIP, MinIP ou média com espessura em
  mm; **"em 3D"**: reconstrução 3D recortada no plano (o observador olha
  para a face do corte, colorida pelo tecido, e através do ar vê o relevo do
  que está atrás; "profundidade de 8 cm" limita até onde se vê; "janela de
  osso" mostra só o esqueleto e "janela angio" destaca vasos com contraste); janela (partes moles, mediastino, pulmão, osso, abdome, angio,
  cérebro); "só o tórax" / "só o abdome"; fundo branco, preto ou cinza.
- **Ajustes por texto** sobre a imagem feita: "2 cm mais lateral", "um pouco
  mais medial", "MIP de 20 mm", "mais espesso", "janela de pulmão", "fundo
  branco". "Desfazer" volta um passo.
- **Localizador**: ao lado, um corte perpendicular com a linha do corte.
  Clicar nele faz o corte passar por aquele ponto (é assim que se leva o
  corte até um achado, como uma hérnia, que não cai na linha pedida); o
  controle embaixo muda a altura do localizador.
- **Saída**: PNG com as letras de orientação (A/P, S/I, D/E), régua em cm e
  a legenda do que foi pedido.

As linhas de superfície são **estimadas**, não medidas: o programa acha os
pulmões pela densidade (ar dentro do corpo; o critério é a proporção do
corpo, não litros, para valer do lactente ao adulto), tira deles a linha média e a
largura de cada hemitórax, e põe a hemiclavicular a 65% do caminho entre a
linha média e a borda lateral do pulmão (proporção anatômica média), e a
paraesternal a 2,5 cm da linha média. A tela avisa quando a linha é
estimada, mostra a distância à linha média e o localizador para conferir.
Sem pulmões no exame (abdome isolado), usa o contorno do corpo e avisa que
é menos confiável.

**IA (opcional)**: se este navegador tiver a nuvem do CineDeck configurada
(o CineDeck guarda o endereço e a chave no armazenamento do navegador, e os
dois programas são servidos pelo mesmo endereço), o pedido vai para a rota
`/diretor` da IA do CineDeck e volta como receita. Saem **só o texto do
pedido** (números longos são trocados por "[número]"), a receita em uso e
seis números de geometria; nenhuma imagem, voxel ou campo do DICOM. A
receita que volta é conferida campo a campo antes de usar. Sem nuvem, ou se
ela falhar, roda o interpretador local (vocabulário acima), que não envia
nada. A barra do diretor mostra qual dos dois está em uso.

Dentro do Claude (o CatStudio aberto como artefato), o diretor pergunta ao
próprio Claude, sem servidor nem chave, mandando as mesmas coisas.

Não faz nesta versão: cortes oblíquos, girar a reconstrução 3D (ela é vista
de frente para o plano), achar a lesão sozinho (a IA não vê a imagem) e medir a clavícula de fato
(para isso seria preciso segmentação, por exemplo o TotalSegmentator).

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
- **Caixa de corte do 3D**: arrastar as alças não mudava o corte. O volume
  era desenhado também na passada em que o vtk.js procura qual alça está sob
  o mouse, e apagava as alças desse buffer; agora o volume fica fora dessa
  passada (patch do vtk.js), o que também evita um quadro 3D inteiro a cada
  movimento do mouse com a ferramenta ligada. O tamanho das vistas passou a
  ser arredondado para pixels inteiros.
- **Privacidade**: nome, ID e nascimento do paciente nunca aparecem (viram
  "Paciente 1"); sem telemetria, dados de exemplo ou serviços remotos; o
  teste automatizado falha se a página fizer qualquer requisição externa.
- **Interface em português**, botão "Abrir pasta do exame", janelas de TC
  usuais e exportação PNG da vista 3D.

## O que foi testado

Tudo abaixo foi executado (Linux, Chrome headless com WebGL por software):

- **32 testes ponta a ponta no navegador** (`catstudio-testes/`): upload
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
- **Esculpir o 3D, osso, luz, vistas pretas e tela inicial**: 51 testes
  unitários, mais 9 das paletas por tecido e 12 da foto final (borracha; caixa de corte girada; tirar mesa com parede torácica fina, mesa encostada e traqueia
  aberta no primeiro corte; janela do 3D; laço, estrutura ligada, fragmentos, clique com caixa de corte,
  crescer por camadas, detecção e correção de osso, volume de dois
  componentes, desfazer, presets de luz, limite da exportação, recuperação do
  contexto de vídeo) e 9 testes no navegador (foto final; cores por tecido; girar a caixa de corte e borracha; dois botões e tirar mesa; laço, clique, giro e desfazer;
  osso translúcido e escondido e crescer segurando; presets de luz, fundo e
  exportação 2×; vistas que voltam depois da perda do contexto WebGL; botão
  da tela inicial).
- **Diretor de arte**: 71 testes unitários (geometria no espaço do paciente
  em duas orientações de aquisição, referências anatômicas num fantoma de
  tronco, inclusive com pulmão colapsado, mesa do tomógrafo fora de centro e
  exame sem pulmões, lactente com a mesa solta; desenho do corte, reconstrução 3D, MIP/MinIP/média, localizador;
  interpretador de pedidos; cliente da nuvem) e 2 testes no navegador (o
  pedido de exemplo, ajustes, clique no localizador, PNG; e o caminho da IA
  com um servidor simulado). **Não testado com exame real**: a estimativa
  das linhas só foi conferida em fantomas, e a rota `/diretor` só com
  servidor simulado.
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
