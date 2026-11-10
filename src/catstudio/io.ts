/**
 * CatStudio — leitura econômica de arquivos DICOM.
 *
 * O VolView original lia cada arquivo inteiro ao importar (tags e
 * agrupamento em séries). Com a pasta de um exame completo (milhares de
 * imagens, ~1 GB) isso passava de 3 GB de memória e derrubava a aba
 * ("Out of Memory"). Aqui só o cabeçalho é lido nessa fase.
 */

const HEADER_PREFIXES = [64 * 1024, 1024 * 1024];
const REQUIRED_TAGS = ['0008|0018', '0028|0010', '0028|0011'];

/**
 * Lê as tags só do começo do arquivo (o cabeçalho vem antes dos pixels). Se o
 * prefixo não bastar (cabeçalho grande, arquivo sem imagem), tenta um prefixo
 * maior e, por fim, o arquivo inteiro — o resultado é sempre o mesmo da
 * leitura completa.
 */
export async function readTagsFromHeader(
  file: File,
  read: (file: File) => Promise<Array<[string, string]>>
): Promise<Array<[string, string]>> {
  for (const size of HEADER_PREFIXES) {
    if (file.size <= size) break;
    try {
      const prefix = new File([file.slice(0, size)], file.name);
      const tags = await read(prefix);
      const keys = new Set(tags.map(([tag]) => tag));
      if (REQUIRED_TAGS.every((tag) => keys.has(tag))) return tags;
    } catch {
      // prefixo curto demais: tenta o próximo
    }
  }
  return read(file);
}
