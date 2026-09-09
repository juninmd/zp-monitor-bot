import { describe, expect, test } from "bun:test";
import { decodeBmp, decodeImage, decodeTga } from "../src/imageDecode";

function buildTga(width: number, height: number, bpp: 24 | 32): Buffer {
  const header = Buffer.alloc(18);
  header[2] = 2; // true-color uncompressed
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = bpp;
  header[17] = 0x20; // top-left origin
  const stride = bpp / 8;
  const pixels = Buffer.alloc(width * height * stride);
  for (let i = 0; i < pixels.length; i += stride) {
    pixels[i] = 0; // B
    pixels[i + 1] = 128; // G
    pixels[i + 2] = 255; // R
    if (bpp === 32) pixels[i + 3] = 255;
  }
  return Buffer.concat([header, pixels]);
}

/** BMP BI_RGB 24bpp bottom-up, com o padding de linha de 4 bytes. */
function buildBmp(width: number, height: number, color: [number, number, number]): Buffer {
  const rowSize = Math.ceil((width * 24) / 32) * 4;
  const pixelBytes = rowSize * height;
  const buffer = Buffer.alloc(54 + pixelBytes);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(54 + pixelBytes, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22); // positivo = bottom-up
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = 54 + y * rowSize + x * 3;
      buffer[at] = color[2];
      buffer[at + 1] = color[1];
      buffer[at + 2] = color[0];
    }
  }
  return buffer;
}

describe("decodeTga", () => {
  test("decodifica 24bpp top-origin com as cores em RGBA", () => {
    const image = decodeTga(buildTga(32, 16, 24));
    expect(image?.width).toBe(32);
    expect(image?.height).toBe(16);
    expect([...(image?.rgba.slice(0, 4) ?? [])]).toEqual([255, 128, 0, 255]);
  });

  test("decodifica 32bpp bottom-origin", () => {
    const tga = buildTga(8, 8, 32);
    tga[17] = 0; // bottom-left
    expect(decodeTga(tga)?.width).toBe(8);
  });

  test("rejeita RLE, grayscale e buffers truncados", () => {
    expect(decodeTga(Buffer.alloc(4))).toBeNull();
    const rle = buildTga(4, 4, 24);
    rle[2] = 10;
    expect(decodeTga(rle)).toBeNull();
    const gray = buildTga(4, 4, 24);
    gray[16] = 8;
    expect(decodeTga(gray)).toBeNull();
  });
});

describe("decodeBmp", () => {
  test("decodifica 24bpp bottom-up respeitando o padding de linha", () => {
    // 3px de largura = 9 bytes de pixel + 3 de padding por linha.
    const image = decodeBmp(buildBmp(3, 2, [10, 20, 30]));
    expect(image?.width).toBe(3);
    expect(image?.height).toBe(2);
    expect([...(image?.rgba.slice(0, 4) ?? [])]).toEqual([10, 20, 30, 255]);
    expect(image?.rgba.length).toBe(3 * 2 * 4);
  });

  test("32bpp fica opaco mesmo com o byte reservado zerado", () => {
    const rowSize = 4 * 4;
    const buffer = Buffer.alloc(54 + rowSize);
    buffer.write("BM", 0, "ascii");
    buffer.writeUInt32LE(54, 10);
    buffer.writeUInt32LE(40, 14);
    buffer.writeInt32LE(4, 18);
    buffer.writeInt32LE(1, 22);
    buffer.writeUInt16LE(32, 28);
    expect(decodeBmp(buffer)?.rgba[3]).toBe(255);
  });

  test("rejeita compressão RLE e assinatura inválida", () => {
    const rle = buildBmp(2, 2, [0, 0, 0]);
    rle.writeUInt32LE(1, 30); // BI_RLE8
    expect(decodeBmp(rle)).toBeNull();
    expect(decodeBmp(Buffer.alloc(100))).toBeNull();
  });
});

describe("decodeImage", () => {
  test("escolhe o decoder pela assinatura", () => {
    expect(decodeImage(buildBmp(2, 2, [1, 2, 3]))?.width).toBe(2);
    expect(decodeImage(buildTga(4, 4, 24))?.width).toBe(4);
    expect(decodeImage(Buffer.from("nada disso"))).toBeNull();
  });
});
