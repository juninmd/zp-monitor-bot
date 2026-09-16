/**
 * Notificações de entrada e saída de jogador real: foto e perfil da Steam,
 * SteamID e a contagem de jogadores no momento do evento.
 *
 * Tudo que vem da Steam é opcional: perfil privado ou API fora do ar degrada
 * campo a campo, nunca cancela o aviso.
 */

import { config } from "./config";
import type { LogEvent } from "./logParser";
import { monitorState } from "./monitorState";
import { recordConnect } from "./playerStore";
import { getStats } from "./state";
import { describeSteamId, formatDuration } from "./steamId";
import { getSteamProfile, type SteamProfile } from "./steamProfile";
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

// Contagem vem do log (state.ts), atualizada no próprio evento; o A2S só
// refletiria a entrada/saída no próximo polling.
export function playerCountLine(
  stats: { humans: number; bots: number },
  map: string | null,
  maxplayers: number | null,
): string {
  const max = maxplayers ? ` de ${maxplayers}` : "";
  const where = map ? ` · 🗺️ <b>${escapeHtml(map)}</b>` : "";
  return `👥 Jogadores: <b>${stats.humans}</b> real(is) + ${stats.bots} bot(s)${max}${where}`;
}

function currentCountLine(): string {
  const info = monitorState.info;
  return playerCountLine(getStats(), info?.map ?? null, info?.maxplayers ?? null);
}

export function joinLines(
  steamRaw: string,
  profileUrl: string | null,
  profile: SteamProfile | null,
): string[] {
  const lines = [`🆔 <code>${escapeHtml(steamRaw)}</code>`];
  if (profile?.profileName) lines.push(`🎭 Perfil: ${escapeHtml(profile.profileName)}`);
  if (profileUrl) lines.push(`🔗 <a href="${profileUrl}">Perfil na Steam</a>`);
  return lines;
}

/**
 * sendPhoto rejeita legenda acima de 1024 caracteres com HTTP 400, e a fila só
 * loga o erro. Acima do limite a foto vai com uma linha e o corpo à parte.
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

export async function announceJoin(ev: Extract<LogEvent, { type: "connect" }>): Promise<void> {
  const steam = describeSteamId(ev.steamId);
  // Persiste a sessão para o histórico (/ranking), mesmo sem exibi-lo aqui.
  await recordConnect({ name: ev.name, steamId: ev.steamId, ip: ev.ip });
  const profile = await getSteamProfile(steam.steam64);
  const header = `🟢 <b>${escapeHtml(ev.name)}</b> entrou`;
  const lines = [...joinLines(steam.raw, steam.profileUrl, profile), currentCountLine()];
  await sendWithAvatar(profile?.avatar ?? null, header, lines);
}

export async function announceLeave(ev: {
  name: string;
  steamId: string;
  reason: string;
  seconds: number | null;
}): Promise<void> {
  const header = `🔴 <b>${escapeHtml(ev.name)}</b> saiu${ev.reason ? ` (${escapeHtml(ev.reason)})` : ""}`;
  const lines = [`🆔 <code>${escapeHtml(ev.steamId)}</code>`];
  if (ev.seconds !== null) lines.push(`⏱️ Ficou: ${formatDuration(ev.seconds)}`);
  lines.push(currentCountLine());
  sendTelegram([header, ...lines].join("\n"));
}
