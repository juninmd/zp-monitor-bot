import { handlePlayerMessage, sanitizeChatReply } from "./agent/agent";
import { config } from "./config";
import type { LogEvent } from "./logParser";
import { renderMapImage } from "./mapImage";
import { getMetrics, recordHumanChat, recordHumanSeen, recordKill } from "./metrics";
import { loadPeakRecord, loadRanking } from "./metricsQueries";
import { consumeMonitorEvents, monitorState } from "./monitorState";
import { agoText, announceJoin, announceLeave, serverContext } from "./playerAnnounce";
import { recordDisconnect } from "./playerStore";
import { renderRadar } from "./radar";
import { getPositions, getSnapshot, runRconCommand } from "./rcon";
import { getStats, playerConnected, playerDisconnected } from "./state";
import { formatDuration } from "./steamId";
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
      const seconds = playerDisconnected(ev.uid, ev.steamId);
      if (ev.steamId !== "BOT") {
        void recordDisconnect(ev.steamId, seconds, ev.reason);
        void announceLeave({
          name: ev.name,
          steamId: ev.steamId,
          reason: ev.reason,
          team: ev.team ?? "",
          seconds,
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

let downSince: number | null = null;

/** Consome as transições detectadas pelo polling e avisa no Telegram. */
export function handleMonitorEvents(): void {
  for (const event of consumeMonitorEvents()) {
    if (event.kind === "map_change") {
      sendTelegram(`🗺️ Mapa trocou: ${escapeHtml(event.message)}`);
    }
    if (event.kind === "round_highlight") {
      sendTelegram(`⚡ ${escapeHtml(event.message)}`);
    }
    if (event.kind === "server_down") {
      downSince = event.t;
      sendTelegram(`🔴 Servidor ficou inacessível (A2S sem resposta).`);
    }
    if (event.kind === "server_up") {
      const down =
        downSince !== null
          ? ` · ficou ${formatDuration(Math.max(0, Math.round((event.t - downSince) / 1000)))} fora`
          : "";
      sendTelegram(`🟢 Servidor voltou ao ar${down}.`);
      downSince = null;
    }
  }
}

function metricsText(): string[] {
  const metrics = getMetrics();
  const lines = [
    `🏆 Hoje (${metrics.day}): 🔫 ${metrics.kills} kills · 💀 ${metrics.deaths} mortes · 💬 ${metrics.chatLines} msgs`,
    `👥 Pico: ${metrics.peakHumans} humanos online · distintos hoje: ${metrics.distinctHumans}`,
  ];
  if (metrics.topFraggers.length) {
    lines.push(
      `🥇 Top fraggers:\n${metrics.topFraggers.map((p) => `• ${escapeHtml(p.name)}: ${p.kills}`).join("\n")}`,
    );
  }
  if (metrics.topWeapons.length) {
    lines.push(
      `🔪 Armas: ${escapeHtml(metrics.topWeapons.map(([w, n]) => `${w} ×${n}`).join(" · "))}`,
    );
  }
  return lines;
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

export async function sendPeriodicStats(): Promise<void> {
  const s = getStats();
  // Bots nunca emitem "connected, address", então nunca chegam no tracker de
  // log: s.bots é estruturalmente 0. A contagem viva do A2S_INFO é a honesta.
  const bots = monitorState.info?.bots ?? 0;
  sendTelegram(
    [
      `📊 Jogadores reais online: ${s.humans} (bots: ${bots})`,
      `Distintos desde o início do monitor: ${s.distinctPlayersSeen}`,
      ...metricsText(),
      ...(await historyText()),
      ...serverContext(),
    ].join("\n"),
  );

  try {
    const snap = await getSnapshot();
    if (snap) {
      const { phase, mode, elapsed, timeLimit } = snap.round;
      const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      const evLines = snap.events
        .slice(0, 5)
        .map((e) => `• ${escapeHtml(e.message)}`)
        .join("\n");
      sendTelegram(
        `🎮 <b>${escapeHtml(mode)}</b> — ${phase === "active" ? "em andamento" : "aguardando"}\n` +
          `⏱️ ${mmss(elapsed)} / ${mmss(timeLimit)}\n` +
          `🧟 Zumbis: ${snap.zombies}  🧍 Humanos: ${snap.humans}` +
          (evLines ? `\n📜 Últimos eventos:\n${evLines}` : ""),
      );
    }
  } catch (err) {
    console.error("[snapshot] failed", err);
  }

  await sendMapSnapshot();
}

/**
 * Print do mapa (overview do servidor com posições) quando dá; radar gerado
 * quando o overview não está acessível; silencioso quando nem jogadores há.
 */
export async function sendMapSnapshot(): Promise<void> {
  try {
    const map = monitorState.info?.map ?? "";
    const players = await getPositions();
    let photo: Buffer | null = null;
    let fromMap = false;
    if (map) {
      photo = await renderMapImage(map, players);
      fromMap = Boolean(photo);
    }
    if (!photo) photo = players.length > 0 ? renderRadar(players) : null;
    if (!photo) return;
    const caption = fromMap
      ? `🗺️ Print do mapa: <b>${escapeHtml(map)}</b>\n🔴▲ zumbi  🔵● humano`
      : "🗺️ Radar (posição + direção)\n🔴▲ zumbi  🔵● humano";
    await sendTelegramPhoto(photo, caption);
  } catch (err) {
    console.error("[map snapshot] failed", err);
  }
}
