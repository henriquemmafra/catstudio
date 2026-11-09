# Licenças

> Isto é um levantamento técnico, não parecer jurídico. Antes de distribuir comercialmente, valide com um advogado.

## O que o CatStudio usa e como

O CatStudio **não copia** código do Slicer: ele instala pelo `pip` os pacotes oficiais e os importa. As obrigações
abaixo passam a valer de verdade quando alguém **redistribui** esses pacotes (um instalador que já traga o Python e as
bibliotecas, por exemplo).

| Componente | Licença | Observações |
|---|---|---|
| **3D Slicer** (MRML, lógicas, displayable managers, vtkITK, dentro do `slicer-core`) | *3D Slicer Contribution and Software License Agreement* — estilo BSD | Permite uso, modificação, uso comercial e incorporação em software proprietário. Ao redistribuir, é obrigatório incluir os termos da Parte B precedidos da frase exigida (cláusula 1b), manter os avisos de copyright, identificar versões modificadas e **não** usar os nomes Brigham and Women's Hospital/colaboradores para endossar o produto. Cláusula 4: software para pesquisa, não aprovado pela FDA; **uso clínico não é recomendado**. Texto integral em `licenses/3D-Slicer-License.txt`. |
| `slicer-core` (empacotamento Kitware) | Apache-2.0 (declarada no pacote) | O pacote declara Apache-2.0; o código do Slicer dentro dele continua sob a licença do Slicer acima. |
| **trame-slicer** 2.0.0 | Apache-2.0 (Kitware) | `licenses/trame-slicer-Apache-2.0.txt`. Manter aviso e NOTICE ao redistribuir. |
| trame, trame-server, trame-rca, trame-common | Apache-2.0 | |
| trame-client, trame-vuetify (Vue 3, Vuetify 3) | MIT | |
| VTK 9.6 | BSD-3-Clause | |
| ITK 5.4 (dentro do `slicer-core`) | Apache-2.0 | |
| DCMTK (dentro do `slicer-core`) | BSD-3-Clause e licenças BSD de componentes | |
| GDCM, OpenJPEG, CharLS, libjpeg (IJG) (dentro do `slicer-core`) | BSD / BSD-2 / BSD-3 / IJG | Codecs DICOM. |
| **Teem** (dentro do `slicer-core`) | **LGPL 2.1 com exceção** ("Simple Library Usage License") | Única dependência copyleft encontrada. É biblioteca dinâmica: ao redistribuir, mantê-la como arquivo separado substituível e incluir o aviso (`licenses/Teem-Simple-Library-Usage-License.txt`). Não contamina o código do CatStudio. |
| pydicom | MIT | Usado só para ler cabeçalhos no catálogo. |
| numpy, lxml, Pillow, aiohttp, demais | BSD / MIT / Apache-2.0 / PSF | Lista completa e gerada automaticamente: `docs/LICENCAS_DEPENDENCIAS.md` (`python scripts/licencas.py`). |
| Qt | — | **Não é usado.** A pilha web dispensa o Qt (LGPL) do Slicer desktop. |

## Licença do próprio CatStudio

Ainda **a definir pelo autor** (o `pyproject.toml` está marcado assim de propósito). Todas as dependências acima
permitem tanto código aberto quanto proprietário. Recomendação: **Apache-2.0** se a intenção é publicar e usar em
pesquisa e ensino (mesma licença do trame-slicer e do ITK, com concessão explícita de patentes); manter fechado também
é compatível, desde que os avisos acima acompanhem qualquer distribuição.

## Aviso de uso

Ferramenta de pesquisa, ensino e apresentação. Não é dispositivo médico, não tem registro na ANVISA nem aprovação da
FDA, e não deve ser usada para diagnóstico ou planejamento de procedimentos.
