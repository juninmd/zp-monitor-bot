import { handlePlayerMessage, sanitizeChatReply } from "./agent/agent";
import { config } from "./config";
import type { LogEvent } from "./logParser";
import { renderMapImage } from "./mapImage";
import { getMetrics, recordHumanChat, recordHumanSeen, recordKill } from "./metrics";
import { consumeMonitorEvents, monitorState } from "./monitorState";
import { recordConnect, recordDisconnect } from "./playerStore";
import { renderRadar } from "./radar";
import { getPositions, getSnapshot, runRconCommand } from "./rcon";
import { getStats, playerConnected, playerDisconnected } from "./state";
import { describeSteamId, formatDuration } from "./steamId";
import { countryFlag, getSteamProfile } from "./steamProfile";
import { escapeHtml, sendTelegram, sendTelegramPhoto, sendTelegramPhotoTo } from "./telegram";

const BR_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

function agoText(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return `${BR_TIME.format(date)} (há ${formatDuration(seconds)})`;
}

/** Contexto vivo do servidor, para a notificação não ser só "fulano entrou". */
function serverContext(): string[] {
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

async function announceJoin(ev: Extract<LogEvent, { type: "connect" }>): Promise<void> {
  const steam = describeSteamId(ev.steamId);
  const history = await recordConnect({ name: ev.name, steamId: ev.steamId, ip: ev.ip });

  const header = history.firstTime
    ? `🆕 <b>${escapeHtml(ev.name)}</b> entrou — <b>PRIMEIRA VEZ</b> no servidor`
    : `🟢 <b>${escapeHtml(ev.name)}</b> entrou — ${history.visits + 1}ª visita`;

  const lines = [
    header,
    `🆔 <code>${escapeHtml(steam.raw)}</code> · ${escapeHtml(steam.origin)}`,
    `🌐 IP: <code>${escapeHtml(ev.ip)}</code>`,
  ];
  // Foto e dados do perfil público da Steam (nome real, país), quando visíveis.
  const profile = await getSteamProfile(steam.steam64);
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
  }
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
  const text = lines.join("\n");
  if (profile?.avatar) {
    await sendTelegramPhotoTo(config.telegramChatId, profile.avatar, text);
  } else {
    sendTelegram(text);
  }
}

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
        const suffix = ev.reason ? ` (${escapeHtml(ev.reason)})` : "";
        const played = seconds === null ? "" : `\n⏱️ Ficou: ${formatDuration(seconds)}`;
        const team = ev.team ? `\n🎽 Time: ${escapeHtml(ev.team)}` : "";
        sendTelegram(
          `🔴 <b>${escapeHtml(ev.name)}</b> saiu${suffix}\n` +
            `🆔 <code>${escapeHtml(ev.steamId)}</code>${team}${played}`,
        );
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
 * Print do mapa (TGA do servidor com posições) quando dá; radar gerado quando
 * o TGA não está acessível; silencioso quando nem jogadores há.
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
