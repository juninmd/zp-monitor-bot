import { describe, expect, mock, test } from "bun:test";

/** BMP BI_RGB 24bpp bottom-up de cor sólida, como o overview do CS 1.6. */
function buildBmp(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 24) / 32) * 4;
  const buffer = Buffer.alloc(54 + rowSize * height);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.fill(0x40, 54);
  return buffer;
}

const OVERVIEW_TXT = `global
{
	ZOOM	1.0
	ORIGIN	0 0 10000
	ROTATED	1
}
layer
{
	IMAGE	"overviews/zm_test.bmp"
	HEIGHT	 10000
}
`;

let fetched: string[][][] = [];

// mock.module é global ao run: preserva os outros exports reais, senão os
// testes de podFiles passam a exercitar o dublê em vez do módulo.
const realPodFiles = await import("../src/podFiles");

mock.module("../src/podFiles", () => ({
  ...realPodFiles,
  fetchPodFiles: async (groups: string[][]) => {
    fetched.push(groups);
    return groups.map((paths) =>
      paths.some((p) => p.endsWith(".txt")) ? Buffer.from(OVERVIEW_TXT, "utf8") : buildBmp(128, 96),
    );
  },
}));

const { clearMapAssetCache, renderMapImage } = await import("../src/mapImage");

describe("renderMapImage", () => {
  test("monta o PNG a partir do overview do pod e sobrepõe os jogadores", async () => {
    clearMapAssetCache();
    fetched = [];
    const png = await renderMapImage("zm_test", [
      { team: "z", x: 0, y: 0, angle: 90 },
      { team: "h", x: 1000, y: -500, angle: 0 },
    ]);
    expect(png).not.toBeNull();
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
    // Um único exec busca txt e bitmap juntos.
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toHaveLength(2);
  });

  test("segundo print do mesmo mapa não volta ao pod", async () => {
    clearMapAssetCache();
    fetched = [];
    await renderMapImage("zm_test", []);
    await renderMapImage("zm_test", []);
    expect(fetched).toHaveLength(1);
  });

  test("mapa vazio nem tenta ler o pod", async () => {
    clearMapAssetCache();
    fetched = [];
    expect(await renderMapImage("", [])).toBeNull();
    expect(fetched).toHaveLength(0);
  });
});
