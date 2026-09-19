import { handlePlayerMessage, sanitizeChatReply } from "./agent/agent";
import { config } from "./config";
import type { LogEvent } from "./logParser";
import { renderMapImage } from "./mapImage";
import { recordHumanChat, recordHumanSeen, recordKill } from "./metrics";
import { loadPeakRecord, loadRanking } from "./metricsQueries";
import { consumeMonitorEvents } from "./monitorState";
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
      break;
    }
    case "validated":
    case "entered":
      break;
  }
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
  const who = isBot ? `🤖 ${escapeHtml(ev.name)}` : `<b>${escapeHtml(ev.name)}</b>`;
  sendTelegram(`💬 ${scope}${who}: ${escapeHtml(ev.message)}`);

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
    if (event.kind === "map_change") void announceMapChange(event.message, event.map ?? "");
  }
}

async function announceMapChange(transition: string, map: string): Promise<void> {
  const caption = `🗺️ Mapa trocou: ${escapeHtml(transition)}`;
  try {
    const png = await renderMapImage(map, []);
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
