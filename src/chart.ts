import { createCanvas } from "@napi-rs/canvas";

const W = 800;
const H = 400;
const PAD = { left: 48, right: 16, top: 44, bottom: 40 };

export interface HistorySeries {
  t: number[];
  players: number[];
  zombies: number[];
  humans: number[];
}

const SERIES = [
  { key: "players", label: "reais", color: "#ffffff" },
  { key: "zombies", label: "zumbis", color: "#e74c3c" },
  { key: "humans", label: "humanos", color: "#3498db" },
] as const;

const CLOCK = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Gráfico das últimas leituras do polling: jogadores reais, zumbis e humanos
 * (os dois últimos contam bots). Devolve null com menos de 2 pontos, quando não
 * há linha para desenhar.
 */
export function renderHistoryChart(history: HistorySeries, title: string): Buffer | null {
  const n = history.t.length;
  if (n < 2) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111318";
  ctx.fillRect(0, 0, W, H);

  const ticks = 4;
  // Múltiplo de `ticks` para os rótulos do eixo saírem igualmente espaçados.
  const peak = Math.ceil(Math.max(ticks, ...SERIES.flatMap((s) => history[s.key])) / ticks) * ticks;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number): number => PAD.left + (i / (n - 1)) * plotW;
  const y = (v: number): number => PAD.top + plotH - (v / peak) * plotH;

  ctx.font = "12px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let i = 0; i <= ticks; i++) {
    const value = Math.round((peak / ticks) * i);
    ctx.strokeStyle = "#22262f";
    ctx.beginPath();
    ctx.moveTo(PAD.left, y(value));
    ctx.lineTo(W - PAD.right, y(value));
    ctx.stroke();
    ctx.fillStyle = "#8a8f9c";
    ctx.fillText(String(value), PAD.left - 8, y(value));
  }

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(CLOCK.format(history.t[0]), PAD.left, H - PAD.bottom + 10);
  ctx.textAlign = "right";
  ctx.fillText(CLOCK.format(history.t[n - 1]), W - PAD.right, H - PAD.bottom + 10);

  for (const s of SERIES) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.key === "players" ? 3 : 2;
    ctx.beginPath();
    history[s.key].forEach((v, i) => {
      if (i === 0) ctx.moveTo(x(i), y(v));
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
  }

  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#c7cbd4";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, PAD.left, 20);

  ctx.font = "13px sans-serif";
  let lx = W - PAD.right;
  ctx.textAlign = "right";
  for (const s of [...SERIES].reverse()) {
    ctx.fillStyle = "#c7cbd4";
    ctx.fillText(s.label, lx, 20);
    lx -= ctx.measureText(s.label).width + 6;
    ctx.fillStyle = s.color;
    ctx.fillRect(lx - 12, 15, 12, 10);
    lx -= 26;
  }
  return canvas.toBuffer("image/png");
}
