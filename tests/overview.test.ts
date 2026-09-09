import { describe, expect, test } from "bun:test";
import { parseOverview, projectToPixels } from "../src/overview";

// Overview real do CS 1.6, no formato que o cl_dll/hud_spectator.cpp lê.
const GOLDSRC_TXT = `// overview description file for de_dust2

global
{
	ZOOM	3.60
	ORIGIN	 -317 -1877 10000
	ROTATED	1
}

layer
{
	IMAGE	"overviews/de_dust2.bmp"
	HEIGHT	 10000
}
`;

describe("parseOverview", () => {
  test("lê zoom, origin, rotated e image do formato GoldSrc", () => {
    expect(parseOverview(GOLDSRC_TXT)).toEqual({
      kind: "goldsrc",
      zoom: 3.6,
      originX: -317,
      originY: -1877,
      rotated: true,
      image: "overviews/de_dust2.bmp",
    });
  });

  test("ROTATED 0 e comentários não quebram o parser", () => {
    const parsed = parseOverview(`global\n{\n\tZOOM 1\n\tORIGIN 0 0 0\n\tROTATED 0 // sem giro\n}`);
    expect(parsed).toMatchObject({ kind: "goldsrc", rotated: false, image: null });
  });

  test("aceita o formato Source como fallback e rejeita txt sem calibração", () => {
    expect(
      parseOverview(`"x"\n{\n\t"pos_x" "-2476"\n\t"pos_y" "1762"\n\t"scale" "4.5"\n}`),
    ).toEqual({
      kind: "source",
      posX: -2476,
      posY: 1762,
      scale: 4.5,
    });
    expect(parseOverview("sem nada aqui")).toBeNull();
    expect(parseOverview(`"x"\n{\n\t"pos_x" "0"\n}`)).toBeNull();
  });
});

describe("projectToPixels", () => {
  // Com zoom 1 a imagem cobre ±4096 em u e ±3072 em v (screenaspect 4/3).
  const rotated = {
    kind: "goldsrc",
    zoom: 1,
    originX: 0,
    originY: 0,
    rotated: true,
    image: null,
  } as const;
  const straight = {
    kind: "goldsrc",
    zoom: 1,
    originX: 0,
    originY: 0,
    rotated: false,
    image: null,
  } as const;

  test("ROTATED 1 mapeia a origem no centro e o canto do mundo no pixel 0,0", () => {
    expect(projectToPixels(rotated, 0, 0, 1024, 768)).toEqual([512, 384]);
    expect(projectToPixels(rotated, -4096, 3072, 1024, 768)).toEqual([0, 0]);
  });

  test("ROTATED 0 troca os eixos: X vira o eixo vertical da imagem", () => {
    expect(projectToPixels(straight, 0, 0, 1024, 768)).toEqual([512, 384]);
    // Y no extremo negativo vai para a direita da imagem; X positivo, para cima.
    const [px, py] = projectToPixels(straight, 1536, -2048, 1024, 768) as [number, number];
    expect(px).toBeGreaterThan(512);
    expect(py).toBeLessThan(384);
  });

  test("zoom encolhe a área coberta e joga posições distantes para fora", () => {
    const zoomed = { ...rotated, zoom: 4 };
    expect(projectToPixels(zoomed, 0, 0, 1024, 768)).toEqual([512, 384]);
    expect(projectToPixels(zoomed, 3000, 0, 1024, 768)).toBeNull();
  });

  test("formato Source projeta com Y invertido (norte no topo)", () => {
    const source = { kind: "source", posX: -1000, posY: 1000, scale: 10 } as const;
    expect(projectToPixels(source, -1000, 1000, 200, 200)).toEqual([0, 0]);
    expect(projectToPixels(source, 0, 0, 200, 200)).toEqual([100, 100]);
  });
});
