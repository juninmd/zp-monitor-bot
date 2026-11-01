import { describe, expect, mock, test } from "bun:test";

/** BMP BI_RGB 24bpp bottom-up de cor sólida, como o overview do CS 1.6. */
function buildBmp(width: number, height: number, bgr?: [number, number, number]): Buffer {
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
  if (!bgr) {
    buffer.fill(0x40, 54);
    return buffer;
  }
  for (let offset = 54; offset + 2 < buffer.length; offset += 3) {
    buffer[offset] = bgr[0];
    buffer[offset + 1] = bgr[1];
    buffer[offset + 2] = bgr[2];
  }
  return buffer;
}

/** Quando true, o bitmap do pod é verde puro: a cor-chave do overview. */
let chromaKeyBitmap = false;

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

/** Quando false, o pod tem o bitmap mas nenhum overviews/<mapa>.txt. */
let overviewAvailable = true;

mock.module("../src/podFiles", () => ({
  ...realPodFiles,
  fetchPodFiles: async (groups: string[][]) => {
    fetched.push(groups);
    return groups.map((paths) => {
      if (!paths.some((p) => p.endsWith(".txt"))) {
        return buildBmp(128, 96, chromaKeyBitmap ? [0, 255, 0] : undefined);
      }
      return overviewAvailable ? Buffer.from(OVERVIEW_TXT, "utf8") : null;
    });
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

  test("bitmap sem calibração devolve null em vez de imagem crua", async () => {
    // Sem overview não dá para posicionar ninguém: mandar a imagem com a
    // legenda "🔴▲ zumbi 🔵● humano" seria mentira. O caller cai no radar.
    clearMapAssetCache();
    overviewAvailable = false;
    try {
      expect(
        await renderMapImage("zm_sem_overview", [{ team: "z", x: 0, y: 0, angle: 0 }]),
      ).toBeNull();
    } finally {
      overviewAvailable = true;
    }
  });

  test("verde puro do overview vira fundo escuro, não placa verde", async () => {
    // O engine trata (0,255,0) como transparente; num PNG cru ele apareceria.
    clearMapAssetCache();
    chromaKeyBitmap = true;
    try {
      const png = await renderMapImage("zm_chroma", []);
      expect(png).not.toBeNull();
      const { loadImage, createCanvas } = await import("@napi-rs/canvas");
      const img = await loadImage(png as Buffer);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
      expect(g).toBeLessThan(180);
      expect(Math.max(r as number, g as number, b as number)).toBeLessThan(60);
    } finally {
      chromaKeyBitmap = false;
    }
  });

  test("estampa o nome do mapa no canto para o print valer sozinho", async () => {
    // Sem o caption (foto encaminhada) o nome do mapa some; ele vai na imagem.
    clearMapAssetCache();
    const png = await renderMapImage("zm_label", []);
    expect(png).not.toBeNull();
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(png as Buffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const region = ctx.getImageData(img.width - 80, img.height - 40, 80, 40).data;
    let hasWhite = false;
    for (let i = 0; i < region.length; i += 4) {
      if ((region[i] ?? 0) > 200 && (region[i + 1] ?? 0) > 200 && (region[i + 2] ?? 0) > 200) {
        hasWhite = true;
        break;
      }
    }
    expect(hasWhite).toBe(true);
  });

  test("trocar de mapa não acumula o RGBA do anterior em cache", async () => {
    clearMapAssetCache();
    fetched = [];
    await renderMapImage("zm_a", []);
    await renderMapImage("zm_b", []);
    await renderMapImage("zm_a", []);
    // Só o mapa atual fica em cache: voltar para zm_a lê o pod de novo.
    expect(fetched).toHaveLength(3);
  });
});

describe("renderMapImage heatmap", () => {
  test("desenha o calor das mortes sem quebrar e muda o PNG", async () => {
    clearMapAssetCache();
    const plain = await renderMapImage("zm_test", []);
    const hot = await renderMapImage("zm_test", [], null, [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(hot).not.toBeNull();
    expect(hot?.equals(plain as Buffer)).toBe(false);
  });
});
