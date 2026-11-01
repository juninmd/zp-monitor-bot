import { handlePlayerMessage, sanitizeChatReply } from "./agent/agent";
import { config } from "./config";
import { recordMapKill, summarizeMap } from "./killFeed";
import type { LogEvent } from "./logParser";
import { renderMapImage } from "./mapImage";
import { recordHumanChat, recordHumanSeen, recordKill } from "./metrics";
import { loadPeakRecord, loadRanking } from "./metricsQueries";
import { consumeMonitorEvents, getPlayerCounts, monitorState } from "./monitorState";
import { agoText, announceJoin, announceLeave } from "./playerAnnounce";
import { recordDisconnect } from "./playerStore";
import { runRconCommand } from "./rcon";
import { playerConnected, playerDisconnected } from "./state";
import { escapeHtml, sendTelegram, sendTelegramPhoto } from "./telegram";

export function handleEvent(ev: LogEvent): void {
  switch (ev.type) {
    case "connect": {
      const isNew = playerConnected({ name: ev.name, uid: ev.uid, steamId: ev.steamId, ip: ev.ip });
      // isNew filtra o segundo "connected" que o mesmo steamid emite durante o
      // handshake da Steam - senão todo jogador rende duas notificações.
      if (isNew && ev.steamId !== "BOT") {
        recordHumanSeen(ev.steamId);
        void announceJoin(ev);
      }
      break;
    }
    case "disconnect": {
      const info = playerDisconnected(ev.uid, ev.steamId);
      if (ev.steamId !== "BOT") {
        void recordDisconnect(ev.steamId, info?.seconds ?? null, ev.reason);
        void announceLeave({
          name: ev.name,
          steamId: ev.steamId,
          reason: ev.reason,
          seconds: info?.seconds ?? null,
          ip: info?.ip ?? null,
        });
      }
      break;
    }
    case "say": {
      relayChat(ev);
      break;
    }
    case "kill": {
      recordKill({
        killerName: ev.killer.name,
        killerSteamId: ev.killer.steamId,
        victimName: ev.victim.name,
        victimSteamId: ev.victim.steamId,
        weapon: ev.weapon,
      });
      recordMapKill({
        map: monitorState.info?.map ?? "",
        killerName: ev.killer.name,
        killerSteamId: ev.killer.steamId,
        victimSteamId: ev.victim.steamId,
        weapon: ev.weapon,
        x: ev.victimPos.x,
        y: ev.victimPos.y,
      });
      break;
    }
    case "validated":
    case "entered":
      break;
  }
}

/** No ZP o time T é o zumbi e o CT é o humano; spectator/unassigned não ganha ícone. */
export function teamIcon(team: string): string {
  if (team === "TERRORIST") return "🧟 ";
  if (team === "CT") return "🧍 ";
  return "";
}

/** Mapa e contagem de gente de verdade no momento da fala. */
export function chatContext(): string {
  const counts = getPlayerCounts();
  const map = monitorState.info?.map;
  const parts = [
    ...(counts ? [`👥 ${counts.humans} real(is) + ${counts.bots} bot(s)`] : []),
    ...(map ? [`🗺️ ${escapeHtml(map)}`] : []),
  ];
  return parts.join(" · ") || "—";
}

/**
 * Repassa o chat do jogo. Falas de bot são descartadas por padrão
 * (CHAT_RELAY_BOTS=false): elas não são interações de jogadores reais, e com
 * o servidor só de bot viram spam puro.
 */
function relayChat(ev: Extract<LogEvent, { type: "say" }>): void {
  const isBot = ev.steamId === "BOT";
  if (isBot && !config.chatRelayBots) return;
  if (!isBot) recordHumanChat();

  const scope = ev.teamOnly ? "(time) " : "";
  const who = isBot
    ? `🤖 ${escapeHtml(ev.name)}`
    : `${teamIcon(ev.team)}<b>${escapeHtml(ev.name)}</b>`;
  const context = isBot ? "" : `\n<i>${chatContext()}</i>`;
  sendTelegram(`💬 ${scope}${who}: ${escapeHtml(ev.message)}${context}`);

  if (!isBot && config.agentTriggerRegex.test(ev.message)) {
    void handleAgentReply(ev);
  }
}

async function handleAgentReply(ev: Extract<LogEvent, { type: "say" }>): Promise<void> {
  try {
    const reply = await handlePlayerMessage(
      { name: ev.name, uid: ev.uid, steamId: ev.steamId },
      ev.message,
    );
    if (!reply) return;

    const clean = sanitizeChatReply(reply);
    if (!clean) return;

    const cleanName = sanitizeChatReply(ev.name) || "jogador";
    await runRconCommand(`amx_csay [IA] ${cleanName}: ${clean}`);
    sendTelegram(`🤖 <b>IA</b> → ${escapeHtml(ev.name)}: ${escapeHtml(clean)}`);
  } catch (err) {
    console.error("[agent] failed to reply", err);
  }
}

/** Consome as transições do polling; só a troca de mapa vira aviso, com o print. */
export function handleMonitorEvents(): void {
  for (const event of consumeMonitorEvents()) {
    if (event.kind === "map_change") {
      void announceMapChange(event.message, event.map ?? "", event.from ?? "");
    }
  }
}

/** Fecha o mapa que acabou: kills, MVPs e arma mais usada por jogadores reais. */
export function recapText(from: string): string {
  const summary = from ? summarizeMap(from, true) : null;
  if (!summary) return "";
  const lines = [`🏁 Resumo de <b>${escapeHtml(summary.map)}</b>: ${summary.kills} kills`];
  if (summary.topFraggers.length) {
    const medals = ["🥇", "🥈", "🥉"];
    lines.push(
      summary.topFraggers
        .map((p, i) => `${medals[i]} ${escapeHtml(p.name)} (${p.kills})`)
        .join(" · "),
    );
  }
  if (summary.topWeapon) {
    lines.push(
      `🔪 Arma do mapa: ${escapeHtml(summary.topWeapon.weapon)} ×${summary.topWeapon.kills}`,
    );
  }
  return `\n${lines.join("\n")}`;
}

async function announceMapChange(transition: string, map: string, from: string): Promise<void> {
  const counts = getPlayerCounts();
  const people = counts ? `\n👥 ${counts.humans} real(is) + ${counts.bots} bot(s)` : "";
  const caption = `🗺️ Mapa trocou: ${escapeHtml(transition)}${people}${recapText(from)}`;
  try {
    const png = await renderMapImage(map, [], counts);
    if (png) {
      await sendTelegramPhoto(png, caption);
      return;
    }
  } catch (err) {
    console.error("[notifier] map image failed", err);
  }
  sendTelegram(caption);
}

/** Ranking da semana e recorde histórico: só existem porque o banco persiste. */
export async function historyText(): Promise<string[]> {
  const [ranking, record] = await Promise.all([loadRanking(7, 5), loadPeakRecord()]);
  const lines: string[] = [];
  if (ranking.length) {
    lines.push(
      `📈 Ranking de 7 dias:\n${ranking
        .map((r, i) => `${i + 1}. ${escapeHtml(r.name)}: ${r.kills}`)
        .join("\n")}`,
    );
  }
  if (record) {
    lines.push(`🏅 Recorde de pico: ${record.humans} humanos (${escapeHtml(agoText(record.at))})`);
  }
  return lines;
}
