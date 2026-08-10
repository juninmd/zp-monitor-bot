import { describe, expect, test } from "bun:test";
import { parseOverviewTxt, tgaToPng } from "../src/mapImage";
import { countryFlag, parseProfileXml } from "../src/steamProfile";

describe("tgaToPng", () => {
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

  test("converte TGA 24bpp top-origin em PNG do mesmo tamanho", () => {
    const png = tgaToPng(buildTga(32, 16, 24));
    expect(png).not.toBeNull();
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  });

  test("converte TGA 32bpp bottom-origin", () => {
    const tga = buildTga(8, 8, 32);
    tga[17] = 0; // bottom-left
    expect(tgaToPng(tga)?.subarray(1, 4).toString()).toBe("PNG");
  });

  test("rejeita formatos não suportados e buffers truncados", () => {
    expect(tgaToPng(Buffer.alloc(4))).toBeNull();
    const rle = buildTga(4, 4, 24);
    rle[2] = 10; // RLE
    expect(tgaToPng(rle)).toBeNull();
    const gray = buildTga(4, 4, 24);
    gray[16] = 8; // grayscale
    expect(tgaToPng(gray)).toBeNull();
  });
});

describe("parseOverviewTxt", () => {
  test("extrai pos e escala (unidades por pixel) do primeiro bloco", () => {
    const cal = parseOverviewTxt(
      `"zm_dust2"
{
	"global" "1"
	"pos_x" "-2476"
	"pos_y" "1762"
	"scale" "4.111816"
	"zoom" "1.0"
}`,
    );
    expect(cal).toEqual({ posX: -2476, posY: 1762, scale: 4.111816 });
  });

  test("aceita world_to_scale e rejeita txt sem calibração", () => {
    expect(
      parseOverviewTxt(`"x"\n{\n\t"world_to_scale" "5.5"\n\t"pos_x" "0"\n\t"pos_y" "0"\n}`),
    ).toEqual({
      posX: 0,
      posY: 0,
      scale: 5.5,
    });
    expect(parseOverviewTxt("sem nada aqui")).toBeNull();
    expect(parseOverviewTxt(`"x"\n{\n\t"pos_x" "0"\n}`)).toBeNull();
  });
});

describe("steamProfile", () => {
  test("parseProfileXml lê o perfil XML público", () => {
    expect(
      parseProfileXml(`<profile>
  <steamID>junin_gamer</steamID>
  <realName>Junior</realName>
  <country>BR</country>
  <avatarFull>https://avatars.akamai.steamstatic.com/abc_full.jpg</avatarFull>
</profile>`),
    ).toEqual({
      profileName: "junin_gamer",
      realName: "Junior",
      countryCode: "BR",
      avatarUrl: "https://avatars.akamai.steamstatic.com/abc_full.jpg",
    });
    expect(parseProfileXml("<profile></profile>").profileName).toBeNull();
  });

  test("countryFlag vira emoji regional, e rejeita código inválido", () => {
    expect(countryFlag("BR")).toBe("🇧🇷");
    expect(countryFlag("br")).toBe("");
    expect(countryFlag(null)).toBe("");
  });
});
