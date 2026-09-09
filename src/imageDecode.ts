/**
 * Decodifica os bitmaps que o GoldSrc guarda no disco do servidor para RGBA.
 * Overviews de CS 1.6 são BMP (`layer { IMAGE "overviews/<mapa>.bmp" }`);
 * alguns servidores substituem por TGA true-color. Nenhum dos dois é
 * comprimido, então o decode cabe em memória sem dependência extra.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA linha a linha, origem no topo-esquerda. */
  rgba: Uint8ClampedArray;
}

/** TGA true-color não comprimido (type 2, 24/32bpp). Outros tipos: null. */
export function decodeTga(buffer: Buffer): DecodedImage | null {
  if (buffer.length < 18 || buffer[2] !== 2) return null;
  const bpp = buffer[16];
  if (bpp !== 24 && bpp !== 32) return null;
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  if (!width || !height) return null;
  const topOrigin = ((buffer[17] ?? 0) & 0x20) !== 0;
  const stride = bpp / 8;
  const dataStart = 18 + (buffer[0] ?? 0) + (buffer[1] ? 768 : 0);
  if (buffer.length < dataStart + width * height * stride) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topOrigin ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const src = dataStart + (srcRow * width + x) * stride;
      const dst = (y * width + x) * 4;
      rgba[dst] = buffer[src + 2] ?? 0;
      rgba[dst + 1] = buffer[src + 1] ?? 0;
      rgba[dst + 2] = buffer[src] ?? 0;
      rgba[dst + 3] = bpp === 32 ? (buffer[src + 3] ?? 255) : 255;
    }
  }
  return { width, height, rgba };
}

/** BMP BI_RGB de 8bpp (com paleta), 24bpp ou 32bpp. Comprimido (RLE): null. */
export function decodeBmp(buffer: Buffer): DecodedImage | null {
  if (buffer.length < 54 || buffer[0] !== 0x42 || buffer[1] !== 0x4d) return null;
  const dataOffset = buffer.readUInt32LE(10);
  const headerSize = buffer.readUInt32LE(14);
  if (headerSize < 40) return null;
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (compression !== 0) return null;
  if (bpp !== 8 && bpp !== 24 && bpp !== 32) return null;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height === 0) return null;
  // Altura positiva = bottom-up, a convenção normal do BMP.
  const bottomUp = rawHeight > 0;

  const paletteStart = 14 + headerSize;
  const stride = bpp / 8;
  const rowSize = Math.ceil((width * bpp) / 32) * 4;
  if (buffer.length < dataOffset + rowSize * height) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      let b: number;
      let g: number;
      let r: number;
      let a = 255;
      if (bpp === 8) {
        const entry = paletteStart + (buffer[rowStart + x] ?? 0) * 4;
        b = buffer[entry] ?? 0;
        g = buffer[entry + 1] ?? 0;
        r = buffer[entry + 2] ?? 0;
      } else {
        const src = rowStart + x * stride;
        b = buffer[src] ?? 0;
        g = buffer[src + 1] ?? 0;
        r = buffer[src + 2] ?? 0;
        // O 4º byte do BMP 32bpp é reservado e costuma vir zerado: tratar como
        // alfa deixaria a imagem inteira transparente.
        if (bpp === 32) a = 255;
      }
      rgba[dst] = r;
      rgba[dst + 1] = g;
      rgba[dst + 2] = b;
      rgba[dst + 3] = a;
    }
  }
  return { width, height, rgba };
}

/** Escolhe o decoder pela assinatura do arquivo. */
export function decodeImage(buffer: Buffer): DecodedImage | null {
  return decodeBmp(buffer) ?? decodeTga(buffer);
}
