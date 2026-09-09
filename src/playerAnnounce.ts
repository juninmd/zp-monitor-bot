/**
 * Notificações de entrada e saída de jogador real. Junta histórico local
 * (player_sessions), perfil público da Steam e sinais de reputação (bans,
 * horas de CS) numa mensagem só, com a foto do perfil quando existe.
 *
 * Tudo que vem da Steam é opcional: perfil privado ou API fora do ar degrada
 * campo a campo, nunca cancela o aviso.
 */

import { config } from "./config";
import type { LogEvent } from "./logParser";
import { monitorState } from "./monitorState";
import { recordConnect } from "./playerStore";
import { describeSteamId, formatDuration } from "./steamId";
import { countryFlag, getSteamProfile } from "./steamProfile";
import { describeSignals, getSteamSignals } from "./steamSignals";
import { escapeHtml, sendTelegram, sendTelegramPhotoTo } from "./telegram";

const BR_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function agoText(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return `${BR_TIME.format(date)} (há ${formatDuration(seconds)})`;
}

/** Contexto vivo do servidor, para a notificação não ser só "fulano entrou". */
export function serverContext(): string[] {
  const info = monitorState.info;
  const telemetry = monitorState.telemetry;
  const lines: string[] = [];
  if (info) {
    lines.push(
      `🗺️ Mapa: <b>${escapeHtml(info.map)}</b> · ${info.players} real(is) + ${info.bots} bots de ${info.maxplayers}`,
    );
  }
  if (telemetry.connected && telemetry.round) {
    lines.push(
      `🎮 Modo: <b>${escapeHtml(telemetry.round.mode)}</b> · 🧟 ${telemetry.zombies} x 🧍 ${telemetry.humans}`,
    );
  }
  const others = monitorState.players.map((p) => p.name).filter(Boolean);
  if (others.length) lines.push(`👥 Outros reais online: ${escapeHtml(others.join(", "))}`);
  return lines;
}

/**
 * sendPhoto rejeita legenda acima de 1024 caracteres com HTTP 400, e a fila só
 * loga o erro - a notificação sumiria inteira justamente nos casos mais ricos
 * (histórico longo, muitos nicks antigos, servidor cheio). Acima do limite a
 * foto vai com uma linha e o corpo vai como mensagem separada.
 */
const CAPTION_LIMIT = 1024;

async function sendWithAvatar(
  avatar: Buffer | null,
  headline: string,
  body: string[],
): Promise<void> {
  const full = [headline, ...body].join("\n");
  if (!avatar) {
    sendTelegram(full);
    return;
  }
  if (full.length <= CAPTION_LIMIT) {
    await sendTelegramPhotoTo(config.telegramChatId, avatar, full);
    return;
  }
  await sendTelegramPhotoTo(config.telegramChatId, avatar, headline);
  sendTelegram(body.join("\n"));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Idade da conta Steam: o sinal mais barato de smurf/conta descartável. */
function accountAgeLine(createdAt: Date): string {
  const days = Math.floor((Date.now() - createdAt.getTime()) / DAY_MS);
  const age =
    days < 60
      ? `${days} dia(s)`
      : days < 730
        ? `${Math.floor(days / 30)} meses`
        : `${Math.floor(days / 365)} anos`;
  const warn = days < 30 ? " ⚠️ conta nova" : "";
  return `📅 Conta criada há ${age}${warn}`;
}

export async function announceJoin(ev: Extract<LogEvent, { type: "connect" }>): Promise<void> {
  const steam = describeSteamId(ev.steamId);
  const history = await recordConnect({ name: ev.name, steamId: ev.steamId, ip: ev.ip });

  const header = history.firstTime
    ? `🆕 <b>${escapeHtml(ev.name)}</b> entrou — <b>PRIMEIRA VEZ</b> no servidor`
    : `🟢 <b>${escapeHtml(ev.name)}</b> entrou — ${history.visits + 1}ª visita`;

  const lines = [
    `🆔 <code>${escapeHtml(steam.raw)}</code> · ${escapeHtml(steam.origin)}`,
    `🌐 IP: <code>${escapeHtml(ev.ip)}</code>`,
  ];

  // Perfil e reputação são independentes: um perfil privado ainda tem bans.
  const [profile, signals] = await Promise.all([
    getSteamProfile(steam.steam64),
    getSteamSignals(steam.steam64),
  ]);
  if (profile) {
    if (profile.profileName && profile.profileName !== ev.name) {
      lines.push(`🎭 Conta: ${escapeHtml(profile.profileName)}`);
    }
    if (profile.realName) lines.push(`🧑 ${escapeHtml(profile.realName)}`);
    if (profile.countryCode) {
      lines.push(
        `🌍 ${countryFlag(profile.countryCode)} <code>${escapeHtml(profile.countryCode)}</code>`,
      );
    }
    if (profile.createdAt) lines.push(accountAgeLine(profile.createdAt));
    if (profile.visibility === "private") lines.push("🔒 Perfil privado");
  }
  lines.push(...describeSignals(signals));

  if (steam.profileUrl) lines.push(`🔗 <a href="${steam.profileUrl}">Perfil na Steam</a>`);
  if (!history.firstTime) {
    if (history.lastSeen) lines.push(`🕘 Última vez: ${escapeHtml(agoText(history.lastSeen))}`);
    if (history.totalSeconds > 0) {
      lines.push(`⏱️ Tempo total acumulado: ${formatDuration(history.totalSeconds)}`);
    }
    if (history.previousNames.length) {
      lines.push(`🏷️ Já usou: ${escapeHtml(history.previousNames.join(", "))}`);
    }
  }
  lines.push(...serverContext());
  await sendWithAvatar(profile?.avatar ?? null, header, lines);
}

/** Saída com a mesma foto e o mesmo contexto de servidor da entrada. */
export async function announceLeave(ev: {
  name: string;
  steamId: string;
  reason: string;
  team: string;
  seconds: number | null;
}): Promise<void> {
  const steam = describeSteamId(ev.steamId);
  const header = `🔴 <b>${escapeHtml(ev.name)}</b> saiu${ev.reason ? ` (${escapeHtml(ev.reason)})` : ""}`;
  const lines = [`🆔 <code>${escapeHtml(ev.steamId)}</code>`];
  if (ev.team) lines.push(`🎽 Time: ${escapeHtml(ev.team)}`);
  if (ev.seconds !== null) lines.push(`⏱️ Ficou: ${formatDuration(ev.seconds)}`);
  lines.push(...serverContext());
  // Perfil já está em cache da entrada: não custa uma chamada nova.
  const profile = await getSteamProfile(steam.steam64);
  await sendWithAvatar(profile?.avatar ?? null, header, lines);
}
