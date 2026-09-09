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

/** Placar 🧟×🧍 no canto, para o print valer sozinho sem a legenda do caption. */
function drawScoreboard(ctx: SKRSContext2D, width: number, players: RadarPlayer[]): void {
  const zombies = players.filter((p) => p.team === "z").length;
  const humans = players.length - zombies;
  const pad = Math.max(6, Math.round(width / 80));
  const size = Math.max(12, Math.round(width / 32));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = "top";
  const label = `${zombies} x ${humans}`;
  const boxWidth = ctx.measureText(label).width + pad * 3 + size;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(pad, pad, boxWidth, size + pad * 2);
  ctx.fillStyle = ZOMBIE_COLOR;
  ctx.fillText(String(zombies), pad * 2, pad * 2);
  const zombieWidth = ctx.measureText(String(zombies)).width;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(" x ", pad * 2 + zombieWidth, pad * 2);
  ctx.fillStyle = HUMAN_COLOR;
  ctx.fillText(String(humans), pad * 2 + zombieWidth + ctx.measureText(" x ").width, pad * 2);
}

/**
 * Print do mapa com as posições sobrepostas. Devolve null quando o bitmap ou
 * a calibração faltam: sem calibração não dá para posicionar ninguém, e
 * mandar a imagem crua com a legenda "🔴▲ zumbi 🔵● humano" seria mentira -
 * o caller cai no radar, que ao menos mostra as posições de verdade.
 */
export async function renderMapImage(map: string, players: RadarPlayer[]): Promise<Buffer | null> {
  if (!map) return null;
  const { overview, image } = await loadAssets(map);
  if (!image || !overview) return null;

  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const base = ctx.createImageData(image.width, image.height);
  base.data.set(image.rgba);
  maskChromaKey(base.data);
  ctx.putImageData(base, 0, 0);

  if (players.length > 0) {
    const r = Math.max(5, Math.round(Math.min(image.width, image.height) / 90));
    for (const p of players) {
      const at = projectToPixels(overview, p.x, p.y, image.width, image.height);
      if (at) drawPlayer(ctx, at[0], at[1], p, r);
    }
    drawScoreboard(ctx, image.width, players);
  }
  return canvas.toBuffer("image/png");
}
