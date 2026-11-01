import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { type DecodedImage, decodeImage } from "./imageDecode";
import { type Overview, parseOverview, projectToPixels } from "./overview";
import { fetchPodFiles } from "./podFiles";
import type { RadarPlayer } from "./rcon";

/**
 * "Print do mapa": o servidor CS 1.6 guarda o overview do mapa em
 * `overviews/<mapa>.txt` (calibração) + o bitmap declarado no `layer { IMAGE }`.
 * Lê ambos via kubectl exec, decodifica e sobrepõe as posições do
 * zp_telemetry_positions. Sem bitmap devolve null e o caller usa o radar.
 */

const ZOMBIE_COLOR = "#e74c3c";
const HUMAN_COLOR = "#3498db";

/**
 * O overview usa verde puro como cor-chave de transparência: o engine não
 * desenha esses pixels, mas um PNG cru mostra a placa verde inteira. Troca
 * pelo fundo escuro do HUD para o print sair como o jogador vê.
 */
const BACKDROP: [number, number, number] = [22, 26, 30];

function maskChromaKey(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    if (r < 60 && g > 180 && b < 60) {
      rgba[i] = BACKDROP[0];
      rgba[i + 1] = BACKDROP[1];
      rgba[i + 2] = BACKDROP[2];
    }
  }
}

const withPrefixes = (path: string): string[] => [`cstrike/${path}`, path, `valve/${path}`];

const txtCandidates = (map: string): string[] => [
  ...withPrefixes(`overviews/${map}.txt`),
  ...withPrefixes(`maps/${map}.txt`),
];

const imageCandidates = (map: string, declared: string | null): string[] => [
  ...(declared ? withPrefixes(declared) : []),
  ...withPrefixes(`overviews/${map}.bmp`),
  ...withPrefixes(`overviews/${map}.tga`),
  ...withPrefixes(`maps/${map}.bmp`),
  ...withPrefixes(`maps/${map}.tga`),
];

interface MapAssets {
  overview: Overview | null;
  image: DecodedImage | null;
}

/**
 * Overview e bitmap não mudam enquanto o mapa é o mesmo, mas cada entrada
 * segura o RGBA decodificado inteiro (4 MB num overview 1024²). Guardar a
 * rotação toda vazaria centenas de MB, então só o mapa atual fica em cache:
 * o custo de um miss é um kubectl exec.
 */
let cachedMap: { map: string; assets: MapAssets } | null = null;

async function loadAssets(map: string): Promise<MapAssets> {
  if (cachedMap?.map === map) return cachedMap.assets;

  const [txtRaw, imageRaw] = await fetchPodFiles([txtCandidates(map), imageCandidates(map, null)]);
  const overview = txtRaw ? parseOverview(txtRaw.toString("utf8")) : null;

  let image = imageRaw ? decodeImage(imageRaw) : null;
  // O layer pode apontar para um bitmap fora dos nomes-padrão que já tentamos.
  const declared = overview?.kind === "goldsrc" ? overview.image : null;
  if (!image && declared) {
    const [fallback] = await fetchPodFiles([withPrefixes(declared)]);
    image = fallback ? decodeImage(fallback) : null;
  }
  if (image && !overview) {
    console.warn(
      `[mapImage] ${map}: bitmap encontrado mas sem calibração utilizável; caindo para o radar`,
    );
  }

  const assets: MapAssets = { overview, image };
  // Só memoriza sucesso: um pod fora do ar não deve congelar "sem mapa".
  if (image) cachedMap = { map, assets };
  return assets;
}

export function clearMapAssetCache(): void {
  cachedMap = null;
}

function drawPlayer(ctx: SKRSContext2D, px: number, py: number, p: RadarPlayer, r: number): void {
  const isZombie = p.team === "z";
  const color = isZombie ? ZOMBIE_COLOR : HUMAN_COLOR;
  const rad = (p.angle * Math.PI) / 180;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.round(r / 3));
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + Math.cos(rad) * r * 2, py - Math.sin(rad) * r * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (isZombie) {
    ctx.moveTo(px, py - r);
    ctx.lineTo(px + r, py + r);
    ctx.lineTo(px - r, py + r);
    ctx.closePath();
  } else {
    ctx.arc(px, py, r * 0.9, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** Triângulo (zumbi) ou círculo (humano), sem direção, para legenda/placar. */
function drawLegendGlyph(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  size: number,
  zombie: boolean,
): void {
  ctx.fillStyle = zombie ? ZOMBIE_COLOR : HUMAN_COLOR;
  ctx.beginPath();
  if (zombie) {
    ctx.moveTo(cx, cy - size * 0.4);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.35);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.35);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * Placar no canto com os mesmos marcadores do mapa (▲ zumbi, ● humano), para o
 * print dizer sozinho o que cada número significa - a legenda do caption some
 * quando a foto é encaminhada.
 */
function drawScoreboard(ctx: SKRSContext2D, width: number, players: RadarPlayer[]): void {
  const zombies = players.filter((p) => p.team === "z").length;
  const humans = players.length - zombies;
  const pad = Math.max(6, Math.round(width / 80));
  const size = Math.max(12, Math.round(width / 32));
  const gap = Math.max(4, Math.round(size / 4));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const zText = String(zombies);
  const hText = String(humans);
  const xText = " x ";
  const zWidth = ctx.measureText(zText).width;
  const hWidth = ctx.measureText(hText).width;
  const xWidth = ctx.measureText(xText).width;
  const content = size + gap + zWidth + gap + xWidth + gap + size + gap + hWidth;
  const boxWidth = content + pad * 2;
  const boxHeight = size + pad * 2;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(pad, pad, boxWidth, boxHeight);

  const midY = pad + boxHeight / 2;
  let x = pad;
  drawLegendGlyph(ctx, x + size / 2, midY, size, true);
  x += size + gap;
  ctx.fillStyle = ZOMBIE_COLOR;
  ctx.fillText(zText, x, midY);
  x += zWidth + gap;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(xText, x, midY);
  x += xWidth + gap;
  drawLegendGlyph(ctx, x + size / 2, midY, size, false);
  x += size + gap;
  ctx.fillStyle = HUMAN_COLOR;
  ctx.fillText(hText, x, midY);
}

export interface RealCounts {
  humans: number;
  bots: number;
}

/**
 * As posições do telemetry incluem os bots, então o placar ▲ x ● mostra times,
 * não gente. Esta caixa abaixo dele diz quantos clientes são pessoas de verdade.
 */
function drawRealCounts(ctx: SKRSContext2D, width: number, counts: RealCounts): void {
  const pad = Math.max(6, Math.round(width / 80));
  const size = Math.max(12, Math.round(width / 40));
  const top = pad + Math.max(12, Math.round(width / 32)) + pad * 2 + pad;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const text = `${counts.humans} reais · ${counts.bots} bots`;
  const boxWidth = ctx.measureText(text).width + pad * 2;
  const boxHeight = size + pad;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(pad, top, boxWidth, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, pad * 2, top + boxHeight / 2);
}

/**
 * Mancha de calor dos pontos de morte: gradientes radiais translúcidos que
 * somam onde se sobrepõem, então os pontos de combate ficam mais quentes.
 */
function drawHeat(
  ctx: SKRSContext2D,
  overview: Overview,
  heat: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): void {
  const radius = Math.max(14, Math.round(Math.min(width, height) / 24));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const spot of heat) {
    const at = projectToPixels(overview, spot.x, spot.y, width, height);
    if (!at) continue;
    const gradient = ctx.createRadialGradient(at[0], at[1], 0, at[0], at[1], radius);
    gradient.addColorStop(0, "rgba(255,120,0,0.28)");
    gradient.addColorStop(1, "rgba(255,120,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(at[0] - radius, at[1] - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

/** Nome do mapa no canto inferior direito, para o print não depender do caption. */
function drawMapLabel(ctx: SKRSContext2D, width: number, height: number, map: string): void {
  const pad = Math.max(6, Math.round(width / 80));
  const size = Math.max(12, Math.round(width / 40));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const textWidth = ctx.measureText(map).width;
  const boxWidth = textWidth + pad * 2;
  const boxHeight = size + pad;
  const x = width - boxWidth - pad;
  const y = height - boxHeight - pad;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(map, x + pad, y + boxHeight / 2);
}

/**
 * Print do mapa com as posições sobrepostas. Devolve null quando o bitmap ou
 * a calibração faltam: sem calibração não dá para posicionar ninguém, e
 * mandar a imagem crua com a legenda "🔴▲ zumbi 🔵● humano" seria mentira -
 * o caller cai no radar, que ao menos mostra as posições de verdade.
 */
export async function renderMapImage(
  map: string,
  players: RadarPlayer[],
  counts?: RealCounts | null,
  heat?: Array<{ x: number; y: number }>,
): Promise<Buffer | null> {
  if (!map) return null;
  const { overview, image } = await loadAssets(map);
  if (!image || !overview) return null;

  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const base = ctx.createImageData(image.width, image.height);
  base.data.set(image.rgba);
  maskChromaKey(base.data);
  ctx.putImageData(base, 0, 0);

  if (heat?.length) drawHeat(ctx, overview, heat, image.width, image.height);

  if (players.length > 0) {
    const r = Math.max(5, Math.round(Math.min(image.width, image.height) / 90));
    for (const p of players) {
      const at = projectToPixels(overview, p.x, p.y, image.width, image.height);
      if (at) drawPlayer(ctx, at[0], at[1], p, r);
    }
    drawScoreboard(ctx, image.width, players);
  }
  if (counts) drawRealCounts(ctx, image.width, counts);
  drawMapLabel(ctx, image.width, image.height, map);
  return canvas.toBuffer("image/png");
}
