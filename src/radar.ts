import "./fonts";
import { createCanvas } from "@napi-rs/canvas";
import type { RadarPlayer } from "./rcon";

const SIZE = 640;
const MARGIN = 40;
const ZOMBIE_COLOR = "#e74c3c";
const HUMAN_COLOR = "#3498db";
const BG_COLOR = "#111318";
const GRID_COLOR = "#22262f";

// No per-map calibration data available; auto-scale to the current frame's
// bounding box (with padding) instead of hardcoding map coordinate ranges.
export function renderRadar(
  players: RadarPlayer[],
  counts?: { humans: number; bots: number } | null,
): Buffer | null {
  if (players.length === 0) return null;

  const xs = players.map((p) => p.x);
  const ys = players.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  const pad = (v: number) => Math.max(v, 200);
  const rangeX = pad(maxX - minX);
  const rangeY = pad(maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  minX = cx - rangeX / 2;
  maxX = cx + rangeX / 2;
  minY = cy - rangeY / 2;
  maxY = cy + rangeY / 2;

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (SIZE / 8) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }

  const toScreen = (x: number, y: number): [number, number] => {
    const sx = MARGIN + ((x - minX) / (maxX - minX)) * (SIZE - 2 * MARGIN);
    // World Y grows "up"-ish in GoldSrc; flip so the plot doesn't look mirrored top/bottom.
    const sy = SIZE - (MARGIN + ((y - minY) / (maxY - minY)) * (SIZE - 2 * MARGIN));
    return [sx, sy];
  };

  for (const p of players) {
    const [sx, sy] = toScreen(p.x, p.y);
    const isZombie = p.team === "z";
    const color = isZombie ? ZOMBIE_COLOR : HUMAN_COLOR;

    const rad = (p.angle * Math.PI) / 180;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(rad) * 14, sy - Math.sin(rad) * 14);
    ctx.stroke();

    // Shape (not just color) tells teams apart too, for colorblind readability.
    ctx.fillStyle = color;
    ctx.beginPath();
    if (isZombie) {
      const r = 7;
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy + r);
      ctx.lineTo(sx - r, sy + r);
      ctx.closePath();
    } else {
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  const zombieCount = players.filter((p) => p.team === "z").length;
  const humanCount = players.filter((p) => p.team === "h").length;

  // Legend: color + shape key so the counts at the bottom aren't the only
  // place a viewer can tell which marker means what.
  ctx.font = "14px sans-serif";
  ctx.fillStyle = ZOMBIE_COLOR;
  ctx.beginPath();
  ctx.moveTo(18, 18);
  ctx.lineTo(25, 32);
  ctx.lineTo(11, 32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c7cbd4";
  ctx.fillText("zumbi (triangulo)", 34, 30);

  ctx.fillStyle = HUMAN_COLOR;
  ctx.beginPath();
  ctx.arc(18, 46, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c7cbd4";
  ctx.fillText("humano (circulo)", 34, 50);

  ctx.fillStyle = "#8a8f9c";
  ctx.fillText(`zumbis: ${zombieCount}  humanos: ${humanCount}`, 10, SIZE - 12);

  if (counts) {
    ctx.fillStyle = "#c7cbd4";
    ctx.fillText(`reais: ${counts.humans}  bots: ${counts.bots}`, 10, SIZE - 30);
  }

  return canvas.toBuffer("image/png");
}
