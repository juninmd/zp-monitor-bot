import { handlePlayerMessage, sanitizeChatReply } from "./agent/agent";
import { config } from "./config";
import { handleGameMasterKill, handleGameMasterMode, resetPlayerStreak } from "./gameMaster";
import { handleInGameCommand, resetRtvVotes } from "./inGameCommands";
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
import { recordKillTimestamp } from "./trustScore";

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
        resetPlayerStreak(ev.steamId);
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
        map: monitorState.info?.map,
        killerPos: ev.killer.pos,
        victimPos: ev.victim.pos,
      });
      if (ev.killer.steamId !== "BOT" && ev.victim.steamId !== "BOT") {
        recordKillTimestamp(ev.killer.steamId);
      }
      void handleGameMasterKill(ev.killer, ev.victim, ev.weapon);
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

  if (!isBot) {
    void processChatTriggers(ev);
  }
}

async function processChatTriggers(ev: Extract<LogEvent, { type: "say" }>): Promise<void> {
  const handled = await handleInGameCommand(
    { name: ev.name, steamId: ev.steamId },
    ev.message,
  ).catch(() => false);
  if (handled) return;
  if (config.agentTriggerRegex.test(ev.message)) {
    await handleAgentReply(ev);
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
      resetRtvVotes();
      void announceMapChange(event.message, event.map ?? "");
    }
  }
  const mode = monitorState.telemetry.round?.mode;
  if (monitorState.telemetry.connected && mode) {
    void handleGameMasterMode(mode);
  }
}

async function announceMapChange(transition: string, map: string): Promise<void> {
  const counts = getPlayerCounts();
  const people = counts ? `\n👥 ${counts.humans} real(is) + ${counts.bots} bot(s)` : "";
  const caption = `🗺️ Mapa trocou: ${escapeHtml(transition)}${people}`;
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
