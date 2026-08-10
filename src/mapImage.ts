import { createCanvas, Image, type SKRSContext2D } from "@napi-rs/canvas";
import { config } from "./config";
import { selectLogPod } from "./logTail";
import type { RadarPlayer } from "./rcon";

/**
 * "Print do mapa": o servidor CS 1.6 guarda a imagem de radar do mapa como
 * `maps/<mapa>.tga` (mais o `maps/<mapa>.txt` de calibração) no mesmo pod.
 * Lê via kubectl exec, converte TGA->PNG com @napi-rs/canvas e sobrepõe as
 * posições do zp_telemetry_positions. Qualquer passo falho degrada para a
 * imagem do mapa sem overlay; sem TGA devolve null e o caller usa o radar.
 */

interface OverviewCalibration {
  posX: number;
  posY: number;
  /** Unidades de mundo por pixel (escala da imagem de radar). */
  scale: number;
}

const TGA_PATHS = (map: string) => [
  `cstrike/maps/${map}.tga`,
  `maps/${map}.tga`,
  `cstrike/maps/overviews/${map}.tga`,
  `maps/overviews/${map}.tga`,
];
const TXT_PATHS = (map: string) => [
  `cstrike/maps/${map}.txt`,
  `maps/${map}.txt`,
  `cstrike/maps/overviews/${map}.txt`,
  `maps/overviews/${map}.txt`,
];

const ZOMBIE_COLOR = "#e74c3c";
const HUMAN_COLOR = "#3498db";

interface KubectlProc {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: () => void;
}

/** Captura a saída de um comando kubectl. Rejeita em exit != 0 ou timeout. */
function kubectlCapture(args: string[], timeoutMs = 6000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let proc: KubectlProc;
    try {
      proc = Bun.spawn(["kubectl", ...args], {
        stdout: "pipe",
        stderr: "ignore",
      }) as unknown as KubectlProc;
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("kubectl timeout"));
    }, timeoutMs);
    (async () => {
      for await (const chunk of proc.stdout) chunks.push(chunk);
      const code = await proc.exited;
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`kubectl exit ${code}`));
    })().catch((error) => {
      clearTimeout(timer);
      proc.kill();
      reject(error);
    });
  });
}

async function selectPod(): Promise<string | null> {
  if (!Bun.which("kubectl")) return null;
  try {
    const raw = await kubectlCapture([
      "get",
      "pods",
      "-n",
      config.namespace,
      "-l",
      config.podSelector,
      "-o",
      "json",
    ]);
    const pods = JSON.parse(raw.toString()) as {
      items: Array<{
        metadata: { name: string; creationTimestamp?: string; deletionTimestamp?: string };
        status?: { phase?: string };
      }>;
    };
    return selectLogPod(pods.items) ?? null;
  } catch {
    return null;
  }
}

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

async function fetchViaPod(paths: string[]): Promise<Buffer | null> {
  if (!Bun.which("kubectl")) return null;
  const pod = await selectPod();
  if (!pod) return null;
  const probe = paths.map((p) => `base64 -w0 ${shellQuote(p)} 2>/dev/null`).join(" || ");
  if (!probe) return null;
  try {
    const out = await kubectlCapture([
      "exec",
      "-n",
      config.namespace,
      pod,
      "-c",
      config.container,
      "--",
      "sh",
      "-c",
      probe,
    ]);
    const b64 = out.toString("utf8").trim();
    if (!b64) return null;
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

/**
 * Converte um TGA true-color (24/32bpp) para PNG. Overviews do GoldSrc são
 * salvas sem compressão (type 2); outros tipos retornam null.
 */
export function tgaToPng(buffer: Buffer): Buffer | null {
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

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const srcRow = topOrigin ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const src = dataStart + (srcRow * width + x) * stride;
      const dst = (y * width + x) * 4;
      image.data[dst] = (buffer[src + 2] ?? 0) as number;
      image.data[dst + 1] = (buffer[src + 1] ?? 0) as number;
      image.data[dst + 2] = (buffer[src] ?? 0) as number;
      image.data[dst + 3] = bpp === 32 ? ((buffer[src + 3] ?? 255) as number) : 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}

/**
 * Lê a calibração do overview: `"pos_x" "-2476"`, `"pos_y" "1762"`,
 * `"scale" "4.11"` (unidades de mundo por pixel) no primeiro bloco do txt.
 */
export function parseOverviewTxt(txt: string): OverviewCalibration | null {
  const numberKey = (key: string): number | null => {
    const m = txt.match(new RegExp(`"${key}"\\s*"(-?\\d+(?:\\.\\d+)?)"`));
    return m ? Number(m[1]) : null;
  };
  const posX = numberKey("pos_x");
  const posY = numberKey("pos_y");
  const scale = numberKey("scale") ?? numberKey("world_to_scale");
  if (posX === null || posY === null || !scale || scale <= 0) return null;
  return { posX, posY, scale };
}

function overlayPlayers(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  players: RadarPlayer[],
  cal: OverviewCalibration,
): void {
  const toScreen = (p: RadarPlayer): [number, number] | null => {
    const sx = (p.x - cal.posX) / cal.scale;
    const sy = (p.y - cal.posY) / cal.scale;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
    return [sx, sy];
  };

  const r = Math.max(5, Math.round(Math.min(width, height) / 90));
  for (const p of players) {
    const at = toScreen(p);
    if (!at) continue;
    const [sx, sy] = at;
    const isZombie = p.team === "z";
    const color = isZombie ? ZOMBIE_COLOR : HUMAN_COLOR;
    const rad = (p.angle * Math.PI) / 180;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.round(r / 3));
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(rad) * r * 2, sy - Math.sin(rad) * r * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    if (isZombie) {
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy + r);
      ctx.lineTo(sx - r, sy + r);
      ctx.closePath();
    } else {
      ctx.arc(sx, sy, r * 0.9, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/**
 * Print do mapa com posições sobrepostas quando a calibração existe; só a
 * imagem do mapa quando não; null quando o TGA nem está disponível.
 */
export async function renderMapImage(map: string, players: RadarPlayer[]): Promise<Buffer | null> {
  if (!map) return null;
  const [tga, txt] = await Promise.all([fetchViaPod(TGA_PATHS(map)), fetchViaPod(TXT_PATHS(map))]);
  if (!tga) return null;

  const base = tgaToPng(tga);
  if (!base) return null;

  const cal = txt ? parseOverviewTxt(txt.toString("utf8")) : null;
  if (!cal || players.length === 0) return base;

  const canvas = createCanvas(tga.readUInt16LE(12), tga.readUInt16LE(14));
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.src = base;
  ctx.drawImage(img, 0, 0);
  overlayPlayers(ctx, canvas.width, canvas.height, players, cal);
  return canvas.toBuffer("image/png");
}
