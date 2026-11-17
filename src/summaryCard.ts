/**
 * Gerador do Card Visual de Resumo Diário / MVP (1200x675 PNG) via
 * `@napi-rs/canvas`, pronto para enviar no Telegram (`/resumo`) ou exibir no
 * dashboard (`/api/summary.png`).
 */

import "./fonts";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { getMetrics, getTopFraggerSteamId } from "./metrics";
import { loadPeakRecord, loadTopMapToday } from "./metricsQueries";
import { monitorState } from "./monitorState";
import { describeSteamId } from "./steamId";
import { getSteamProfile } from "./steamProfile";

export interface SummaryCardData {
  serverName: string;
  day: string;
  kills: number;
  deaths: number;
  peakHumans: number;
  distinctHumans: number;
  chatLines: number;
  topMap: string | null;
  allTimePeak: { humans: number; at: string } | null;
  topFraggers: Array<{ name: string; kills: number; deaths: number }>;
  topWeapons: Array<[string, number]>;
  mvpAvatar: Buffer | null;
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCardPanel(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent?: string,
): void {
  ctx.fillStyle = "#111824";
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = accent ?? "#233047";
  ctx.lineWidth = accent ? 2 : 1.5;
  roundRect(ctx, x, y, w, h, 18);
  ctx.stroke();
}

export async function renderSummaryCard(data: SummaryCardData): Promise<Buffer> {
  const W = 1200;
  const H = 675;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Fundo escuro com gradiente radial sutil
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#080c12");
  bg.addColorStop(0.5, "#0d1420");
  bg.addColorStop(1, "#090d14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(200, 80, 10, 200, 80, 480);
  glow.addColorStop(0, "rgba(72, 213, 151, 0.14)");
  glow.addColorStop(1, "rgba(72, 213, 151, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const zGlow = ctx.createRadialGradient(1020, 560, 10, 1020, 560, 420);
  zGlow.addColorStop(0, "rgba(255, 77, 94, 0.14)");
  zGlow.addColorStop(1, "rgba(255, 77, 94, 0)");
  ctx.fillStyle = zGlow;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#48d597";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("ZOMBIE PLAGUE · RELATORIO DIARIO", 48, 52);

  ctx.fillStyle = "#eef4ff";
  ctx.font = "bold 36px sans-serif";
  ctx.fillText(data.serverName || "server-do-junin", 48, 96);

  ctx.fillStyle = "#8fa0b8";
  ctx.font = "bold 18px sans-serif";
  const dateLabel = `Dia ${data.day}`;
  const dateWidth = ctx.measureText(dateLabel).width;
  ctx.fillText(dateLabel, W - 48 - dateWidth, 92);

  // KPI strip (4 cards)
  const kpis: Array<{ label: string; value: string; sub: string; color: string }> = [
    {
      label: "KILLS HUMANOS",
      value: String(data.kills),
      sub: `${data.deaths} mortes`,
      color: "#ff4d5e",
    },
    {
      label: "PICO DE HOJE",
      value: `${data.peakHumans}`,
      sub: data.allTimePeak ? `Recorde: ${data.allTimePeak.humans}` : "jogadores reais",
      color: "#48d597",
    },
    {
      label: "JOGADORES UNICOS",
      value: String(data.distinctHumans),
      sub: `${data.chatLines} msgs no chat`,
      color: "#4ba3ff",
    },
    {
      label: "MAPA DESTAQUE",
      value: (data.topMap || "—").slice(0, 18),
      sub: "maior movimento hoje",
      color: "#f5b041",
    },
  ];

  const kpiY = 128;
  const kpiW = 258;
  const kpiH = 112;
  const kpiGap = 24;
  kpis.forEach((k, idx) => {
    const x = 48 + idx * (kpiW + kpiGap);
    drawCardPanel(ctx, x, kpiY, kpiW, kpiH);
    ctx.fillStyle = "#8fa0b8";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(k.label, x + 20, kpiY + 30);

    ctx.fillStyle = k.color;
    ctx.font = k.value.length > 10 ? "bold 24px sans-serif" : "bold 36px sans-serif";
    ctx.fillText(k.value, x + 20, kpiY + 72);

    ctx.fillStyle = "#7a8ca5";
    ctx.font = "13px sans-serif";
    ctx.fillText(k.sub, x + 20, kpiY + 96);
  });

  // Painel esquerdo: MVP do Dia
  const mvpX = 48;
  const mvpY = 264;
  const mvpW = 460;
  const mvpH = 360;
  drawCardPanel(ctx, mvpX, mvpY, mvpW, mvpH, "#f5b041");

  ctx.fillStyle = "#f5b041";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("MVP DO DIA", mvpX + 26, mvpY + 36);

  const mvp = data.topFraggers[0];
  const avatarSize = 112;
  const ax = mvpX + 26;
  const ay = mvpY + 62;

  ctx.save();
  roundRect(ctx, ax, ay, avatarSize, avatarSize, 18);
  ctx.clip();
  if (data.mvpAvatar) {
    try {
      const img = await loadImage(data.mvpAvatar);
      ctx.drawImage(img, ax, ay, avatarSize, avatarSize);
    } catch {
      ctx.fillStyle = "#1b2738";
      ctx.fillRect(ax, ay, avatarSize, avatarSize);
    }
  } else {
    ctx.fillStyle = "#1b2738";
    ctx.fillRect(ax, ay, avatarSize, avatarSize);
    ctx.fillStyle = "#f5b041";
    ctx.font = "bold 46px sans-serif";
    const initial = (mvp?.name?.[0] ?? "?").toUpperCase();
    const iw = ctx.measureText(initial).width;
    ctx.fillText(initial, ax + (avatarSize - iw) / 2, ay + 72);
  }
  ctx.restore();

  if (mvp) {
    ctx.fillStyle = "#eef4ff";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(mvp.name.slice(0, 18), ax + avatarSize + 22, ay + 40);

    const kd = (mvp.kills / Math.max(1, mvp.deaths)).toFixed(2);
    ctx.fillStyle = "#48d597";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`${mvp.kills} frags`, ax + avatarSize + 22, ay + 74);

    ctx.fillStyle = "#8fa0b8";
    ctx.font = "16px sans-serif";
    ctx.fillText(`${mvp.deaths} mortes · K/D ${kd}`, ax + avatarSize + 22, ay + 102);
  } else {
    ctx.fillStyle = "#8fa0b8";
    ctx.font = "20px sans-serif";
    ctx.fillText("Sem frags registrados hoje", ax + avatarSize + 22, ay + 64);
  }

  // Top Armas dentro do painel MVP
  ctx.fillStyle = "#8fa0b8";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("ARMAS MAIS LETAIS DE HOJE", mvpX + 26, mvpY + 216);

  const maxWeaponCount = Math.max(1, data.topWeapons[0]?.[1] ?? 1);
  if (data.topWeapons.length === 0) {
    ctx.fillStyle = "#6c7c93";
    ctx.font = "15px sans-serif";
    ctx.fillText("Aguardando combates de hoje...", mvpX + 26, mvpY + 252);
  } else {
    data.topWeapons.slice(0, 3).forEach(([weapon, count], i) => {
      const wy = mvpY + 244 + i * 36;
      const barW = Math.max(24, Math.round((count / maxWeaponCount) * 240));
      ctx.fillStyle = "#dbe6f5";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(weapon.slice(0, 16), mvpX + 26, wy + 14);

      ctx.fillStyle = "#1a2535";
      roundRect(ctx, mvpX + 165, wy, 240, 18, 6);
      ctx.fill();

      ctx.fillStyle = i === 0 ? "#ff4d5e" : i === 1 ? "#f5b041" : "#4ba3ff";
      roundRect(ctx, mvpX + 165, wy, barW, 18, 6);
      ctx.fill();

      ctx.fillStyle = "#eef4ff";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(String(count), mvpX + 415, wy + 14);
    });
  }

  // Painel direito: Top 5 Fraggers
  const rankX = 532;
  const rankY = 264;
  const rankW = 620;
  const rankH = 360;
  drawCardPanel(ctx, rankX, rankY, rankW, rankH);

  ctx.fillStyle = "#eef4ff";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Top Fraggers do Dia", rankX + 26, rankY + 42);

  ctx.fillStyle = "#7a8ca5";
  ctx.font = "13px sans-serif";
  ctx.fillText("Apenas abates entre jogadores reais", rankX + 26, rankY + 64);

  const maxKills = Math.max(1, data.topFraggers[0]?.kills ?? 1);
  if (data.topFraggers.length === 0) {
    ctx.fillStyle = "#6c7c93";
    ctx.font = "16px sans-serif";
    ctx.fillText("Nenhuma kill registrada hoje ainda.", rankX + 26, rankY + 120);
  } else {
    data.topFraggers.slice(0, 5).forEach((p, idx) => {
      const ry = rankY + 96 + idx * 50;
      const kd = (p.kills / Math.max(1, p.deaths)).toFixed(2);
      const fillW = Math.max(30, Math.round((p.kills / maxKills) * 280));

      ctx.fillStyle = idx === 0 ? "#f5b041" : "#8fa0b8";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(`#${idx + 1}`, rankX + 26, ry + 20);

      ctx.fillStyle = "#eef4ff";
      ctx.font = "bold 17px sans-serif";
      ctx.fillText(p.name.slice(0, 18), rankX + 70, ry + 20);

      ctx.fillStyle = "#182231";
      roundRect(ctx, rankX + 250, ry + 5, 280, 18, 7);
      ctx.fill();

      ctx.fillStyle = idx === 0 ? "#48d597" : "#4ba3ff";
      roundRect(ctx, rankX + 250, ry + 5, fillW, 18, 7);
      ctx.fill();

      ctx.fillStyle = "#eef4ff";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(`${p.kills}`, rankX + 542, ry + 20);

      ctx.fillStyle = "#7a8ca5";
      ctx.font = "12px sans-serif";
      ctx.fillText(`K/D ${kd}`, rankX + 542, ry + 36);
    });
  }

  ctx.fillStyle = "#56657a";
  ctx.font = "12px sans-serif";
  ctx.fillText("zp-monitor-bot · Command Center", 48, H - 18);

  return canvas.toBuffer("image/png");
}

export async function buildTodaySummaryData(): Promise<SummaryCardData> {
  const metrics = getMetrics();
  const topSteamId = getTopFraggerSteamId();
  const steam64 = topSteamId ? describeSteamId(topSteamId).steam64 : null;
  const [peakRecord, topMap, profile] = await Promise.all([
    loadPeakRecord(),
    loadTopMapToday(),
    steam64 ? getSteamProfile(steam64).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    serverName: monitorState.info?.name ?? "server-do-junin",
    day: metrics.day,
    kills: metrics.kills,
    deaths: metrics.deaths,
    peakHumans: metrics.peakHumans,
    distinctHumans: metrics.distinctHumans,
    chatLines: metrics.chatLines,
    topMap: topMap ?? monitorState.info?.map ?? null,
    allTimePeak: peakRecord
      ? {
          humans: peakRecord.humans,
          at: peakRecord.at.toLocaleDateString("pt-BR"),
        }
      : null,
    topFraggers: metrics.topFraggers,
    topWeapons: metrics.topWeapons,
    mvpAvatar: profile?.avatar ?? null,
  };
}
