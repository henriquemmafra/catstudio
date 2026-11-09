# CatStudio — auditoria do 3D Slicer e arquitetura escolhida

Base analisada: código-fonte oficial `Slicer/Slicer` (estável **v5.12.4** e `main` de 09/11/2026, 5.13-dev),
documentação em `Docs/` (fonte do slicer.readthedocs.io), `KitwareMedical/SlicerCustomAppTemplate` e
`KitwareMedical/trame-slicer` **v2.0.0**.

## 1. Como o Slicer é organizado

O Slicer é empilhado em camadas, e a fronteira que importa para uma aplicação web é a do Qt:

| Camada | Onde está | Depende de Qt? | O que faz |
|---|---|---|---|
| **MRML** (modelo de dados) | `Libs/MRML/Core` | não | Cena com nós observáveis: volumes (`vtkMRMLScalarVolumeNode` com matriz IJK→RAS), displays, vistas (`vtkMRMLSliceNode`, `vtkMRMLViewNode`), câmeras, transformações, ROI, segmentações |
| **Lógicas** | `Libs/MRML/Logic`, `Base/Logic`, `Modules/Loadable/*/Logic` | não | Regras: fatiamento (`vtkMRMLSliceLogic`), aplicação (`vtkMRMLApplicationLogic`), volume rendering (`vtkSlicerVolumeRenderingLogic`), volumes, recorte |
| **Displayable managers** | `Libs/MRML/DisplayableManager`, `Modules/*/MRMLDM` | não | Traduzem a cena MRML em atores VTK: fatias, régua, marcador de orientação, cruz, interseção de planos, **ray casting GPU** (`vtkMRMLVolumeRenderingDisplayableManager`) |
| **Leitura de imagens** | `Libs/vtkITK` + ITK 5.4 + GDCM + DCMTK | não | `vtkITKArchetypeImageSeriesScalarReader`: séries DICOM, inclusive JPEG/JPEG-LS/JPEG 2000/RLE |
| **Widgets Qt** | `Libs/MRML/Widgets`, `Base/QTGUI`, `Modules/*/Widgets` | **sim** | Vistas `qMRMLSliceWidget`/`qMRMLThreeDView`, painéis dos módulos |
| **Módulos Python** | `Modules/Scripted` (DICOM, DICOMLib, DICOMPlugins, DataProbe…) | majoritariamente sim | Banco DICOM (CTK), navegador DICOM, anotações dos cortes |
| **Aplicação** | `Applications/SlicerApp`, `Base/QTApp` | sim | Janela principal, carregamento de módulos, configurações |
| **SuperBuild** | `SuperBuild/` | — | VTK 9.4–9.6, ITK 5.4, CTK, DCMTK, Python 3.12, Qt 5.15 ou 6.8 |

Tipos de módulo: **CLI** (executáveis com interface gerada a partir de XML), **loadable** (C++ com Logic/MRML/MRMLDM/Widgets)
e **scripted** (Python). O volume rendering, por exemplo, é um módulo loadable cujas três camadas de baixo
(MRML, Logic, MRMLDM) não usam Qt; só `Widgets/` e o widget do módulo usam.

Tudo abaixo da linha do Qt é embrulhado em Python pelo próprio build do Slicer e, desde 2025, é publicado pela
Kitware como o pacote **`slicer-core`** no PyPI, com wheels para Windows e Linux (a 5.12.4.0 acompanha a versão
estável; o trame-slicer 2.0.0 é testado com a 5.11.0.6).

## 2. O que dá para reaproveitar diretamente

Usado pelo CatStudio sem nenhuma alteração:

- **Leitura DICOM**: vtkITK (GDCM com fallback DCMTK), conversão LPS→RAS, ordenação por posição, regularização de
  geometria irregular por transformação de aquisição (lógica do `DICOMScalarVolumePlugin`, adaptada no trame-slicer).
- **Geometria**: matriz IJK→RAS do volume, inclusive **cisalhada** (gantry tilt), e espaçamento anisotrópico.
- **MPR**: `vtkMRMLSliceLogic` (reamostragem com a matriz completa), slab MIP/MinIP/média, réguas, linhas de interseção
  de planos, cursor (`vtkMRMLCrosshairNode`), modo de interação "janela/nível".
- **Reconstrução 3D**: `vtkSlicerVolumeRenderingLogic` + ray casting GPU (`vtkOpenGLGPUVolumeRayCastMapper`), os 30
  presets de `presets.xml`, qualidade/oversampling, suavização de superfície, MIP, recorte por ROI.
- **Câmera**: `vtkMRMLCameraNode` (vistas anatômicas, rotação por eixo RAS), marcador de orientação.

Disponível no `slicer-core`, mas fora desta etapa: segmentação (editor e efeitos), marcações/medidas, sequências,
transformações, cena .mrb.

Não disponível na pilha web (fica no lado Qt): banco/navegador DICOM do CTK, rede DICOM (C-FIND/C-MOVE), anotações
de canto (DataProbe), console Python, gerenciador de extensões, **sombras SSAO da vista 3D** (configuradas em
`qMRMLThreeDView`).

## 3. Alternativas avaliadas

| Caminho | Web? | Mexe no núcleo? | Esforço até protótipo | Veredito |
|---|---|---|---|---|
| **Custom Slicer Application** (`SlicerCustomAppTemplate`) | não (desktop Qt) | não, mas exige compilar o Slicer inteiro (Visual Studio + Qt, horas) e manter o build | alto | bom para uma futura edição desktop com marca própria; não atende "programa web" |
| **Extensão Python com interface própria** no Slicer desktop | não | não | baixo | protótipo rápido, mas continua sendo o Slicer desktop |
| **Slicer desktop + módulo WebServer** como servidor remoto | parcial | não | médio | depende de uma janela do Slicer aberta, API limitada e um endpoint de execução de código perigoso; frágil |
| **slicer-core + trame-slicer** (escolhido) | **sim** | **não** | **baixo** | núcleo oficial do Slicer como biblioteca, interface web própria |
| Visualizador só no navegador (vtk.js/Cornerstone/VolView) | sim | — | médio | não usa o Slicer; descartado pelo requisito |

## 4. Arquitetura escolhida

```
Navegador (Vue + Vuetify, via trame)           Servidor Python local (127.0.0.1)
┌──────────────────────────────┐   websocket   ┌───────────────────────────────────────────────┐
│ barra · painéis · 4 vistas   │◀────────────▶ │ catstudio.app        estado, eventos, UI       │
│ (imagens transmitidas pelo   │  imagens +    │ catstudio.dicom_index catálogo/veredito (pydicom)│
│  servidor, eventos de mouse  │  eventos      │ catstudio.loader     carga + conferência        │
│  enviados de volta)          │               │ catstudio.rendering  estilos 3D sobre presets   │
└──────────────────────────────┘               │ catstudio.views      planos anatômicos          │
                                               │ ───────────────────────────────────────────────│
                                               │ trame-slicer 2.0.0 (Kitware, Apache-2.0)        │
                                               │ slicer-core 5.11.0.6 = MRML, lógicas, DM, vtkITK│
                                               │ VTK 9.6 (OpenGL na GPU da máquina)              │
                                               └───────────────────────────────────────────────┘
```

- **Nenhuma linha do Slicer foi alterada.** O CatStudio é um pacote Python que importa o núcleo oficial.
- O processamento e a renderização acontecem no computador que roda o servidor; no uso normal é o próprio PC do
  usuário, então o exame não sai da máquina. O navegador só recebe imagens das vistas.
- A interface é própria (não é o Slicer "no navegador"), o que deixa espaço para o estúdio simples e elegante pedido.

## 5. Desvios conscientes do comportamento padrão do Slicer

1. **Planos anatômicos verdadeiros.** Ao exibir um volume, o Slicer gira as vistas para o plano de aquisição
   (`FitSliceToContent` → `RotateSliceToLowestVolumeAxes`). Numa aquisição oblíqua, o "axial" fica oblíquo; com gantry
   tilt (matriz cisalhada), a rotação produz uma matriz de corte **não ortonormal** e distorce a vista sagital
   (verificado: um marcador esférico aparece elíptico). O CatStudio recoloca axial/coronal/sagital nos eixos do paciente
   (`views.standard_planes`).
2. **Troca atômica das funções de transferência com a renderização bloqueada.** Esvaziar e repovoar uma função
   enquanto a vista renderiza deixa um estado intermediário que a cadeia de volume rendering completa com pontos nos
   extremos de HU do exame; esses pontos sobrevivem (verificado: com opacidade 0%, coluna e marcador continuavam
   visíveis). O CatStudio monta a função ao lado e a copia de uma vez, com a vista bloqueada.
3. **Séries divididas antes da leitura.** O leitor do trame-slicer falha com dimensões mistas na mesma série e
   duplica volumes quando há vários estudos na mesma pasta; o catálogo do CatStudio entrega ao Slicer uma pilha
   homogênea por vez.

## 6. Caminho para uma edição desktop (opcional, futuro)

Os módulos `catstudio.dicom_index`, `geometry`, `rendering` e `views` só dependem de MRML/VTK. Se um dia valer a pena
uma versão desktop com instalador e marca própria, eles podem ser reaproveitados num módulo "Home" de uma
aplicação gerada pelo `SlicerCustomAppTemplate`, que é exatamente o padrão que a Kitware usa nesses projetos.
