/**
 * Calibração do overview (o "radar" do mapa) e projeção mundo -> pixel.
 *
 * CS 1.6 usa `overviews/<mapa>.txt` no formato do HLSDK
 * (`cl_dll/hud_spectator.cpp`): `global { ZOOM z ORIGIN x y z ROTATED 0|1 }`
 * e `layer { IMAGE "overviews/<mapa>.bmp" HEIGHT h }`. Alguns servidores
 * carregam no lugar um txt no formato Source (`"pos_x"/"pos_y"/"scale"`),
 * então os dois são aceitos.
 */

/** screenaspect fixo em 4/3 no DrawOverviewLayer do HLSDK. */
const SCREEN_ASPECT = 4 / 3;
const HALF_WORLD = 4096;

export interface GoldSrcOverview {
  kind: "goldsrc";
  zoom: number;
  originX: number;
  originY: number;
  rotated: boolean;
  /** Caminho do bitmap declarado no layer, quando presente. */
  image: string | null;
}

export interface SourceOverview {
  kind: "source";
  posX: number;
  posY: number;
  /** Unidades de mundo por pixel. */
  scale: number;
}

export type Overview = GoldSrcOverview | SourceOverview;

const TOKEN_RE = /"([^"]*)"|([^\s{}]+)|([{}])/g;

function tokenize(txt: string): string[] {
  const clean = txt.replace(/\/\/[^\n]*/g, "");
  const tokens: string[] = [];
  for (const m of clean.matchAll(TOKEN_RE)) tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  return tokens;
}

function parseGoldSrc(tokens: string[]): GoldSrcOverview | null {
  let zoom: number | null = null;
  let originX: number | null = null;
  let originY: number | null = null;
  let rotated = false;
  let image: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const key = (tokens[i] ?? "").toLowerCase();
    const value = tokens[i + 1] ?? "";
    if (key === "zoom") zoom = Number(value);
    else if (key === "origin") {
      originX = Number(tokens[i + 1]);
      originY = Number(tokens[i + 2]);
    } else if (key === "rotated") rotated = Number(value) !== 0;
    else if (key === "image") image = value || null;
  }

  if (zoom === null || !Number.isFinite(zoom) || zoom <= 0) return null;
  if (originX === null || !Number.isFinite(originX)) return null;
  if (originY === null || !Number.isFinite(originY)) return null;
  return { kind: "goldsrc", zoom, originX, originY, rotated, image };
}

function parseSource(tokens: string[]): SourceOverview | null {
  const numberKey = (key: string): number | null => {
    const at = tokens.indexOf(key);
    if (at === -1) return null;
    const value = Number(tokens[at + 1]);
    return Number.isFinite(value) ? value : null;
  };
  const posX = numberKey("pos_x");
  const posY = numberKey("pos_y");
  const scale = numberKey("scale") ?? numberKey("world_to_scale");
  if (posX === null || posY === null || !scale || scale <= 0) return null;
  return { kind: "source", posX, posY, scale };
}

export function parseOverview(txt: string): Overview | null {
  const tokens = tokenize(txt);
  return parseGoldSrc(tokens) ?? parseSource(tokens);
}

/**
 * Projeta uma posição de mundo no pixel do overview. Devolve null quando cai
 * fora da imagem. Deriva do quad que o DrawOverviewLayer desenha: a imagem
 * cobre 2*hx por 2*hy unidades ao redor da origem, com os eixos trocados
 * quando ROTATED é 0.
 */
export function projectToPixels(
  overview: Overview,
  worldX: number,
  worldY: number,
  width: number,
  height: number,
): [number, number] | null {
  let u: number;
  let v: number;
  if (overview.kind === "source") {
    u = (worldX - overview.posX) / overview.scale / width;
    v = (overview.posY - worldY) / overview.scale / height;
  } else {
    const hx = HALF_WORLD / overview.zoom;
    const hy = HALF_WORLD / (overview.zoom * SCREEN_ASPECT);
    if (overview.rotated) {
      u = (worldX - overview.originX + hx) / (2 * hx);
      v = (overview.originY + hy - worldY) / (2 * hy);
    } else {
      u = (overview.originY + hx - worldY) / (2 * hx);
      v = (overview.originX + hy - worldX) / (2 * hy);
    }
  }
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null;
  return [u * width, v * height];
}
