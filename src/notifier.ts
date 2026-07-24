import { sendTelegram, sendTelegramPhoto, escapeHtml } from "./telegram";
import { playerConnected, playerDisconnected, getStats } from "./state";
import type { LogEvent } from "./logParser";
import { getPositions, getSnapshot, runRconCommand } from "./rcon";
import { renderRadar } from "./radar";
import { config } from "./config";
import { handlePlayerMessage, sanitizeChatReply } from "./agent/agent";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}min`;
  if (m) return `${m}min ${s}s`;
  return `${s}s`;
}

export function handleEvent(ev: LogEvent): void {
  switch (ev.type) {
    case "connect": {
      const isNew = playerConnected({ name: ev.name, uid: ev.uid, steamId: ev.steamId, ip: ev.ip });
      if (isNew && ev.steamId !== "BOT") {
        sendTelegram(
          `🟢 <b>${escapeHtml(ev.name)}</b> entrou\nSteamID: <code>${escapeHtml(ev.steamId)}</code>\nIP: <code>${escapeHtml(ev.ip)}</code>`,
        );
      }
      break;
    }
    case "disconnect": {
      const seconds = playerDisconnected(ev.uid, ev.steamId);
      if (ev.steamId !== "BOT") {
        const suffix = ev.reason ? ` (${escapeHtml(ev.reason)})` : "";
        const played = seconds === null ? "" : `\nFicou: ${formatDuration(seconds)}`;
        sendTelegram(
          `🔴 <b>${escapeHtml(ev.name)}</b> saiu${suffix}\nSteamID: <code>${escapeHtml(ev.steamId)}</code>${played}`,
        );
      }
      break;
    }
    case "say": {
      if (ev.steamId !== "BOT") {
        const scope = ev.teamOnly ? "(time) " : "";
        sendTelegram(`💬 ${scope}<b>${escapeHtml(ev.name)}</b>: ${escapeHtml(ev.message)}`);

        if (config.agentTriggerRegex.test(ev.message)) {
          void handleAgentReply(ev);
        }
      }
      break;
    }
    case "validated":
    case "entered":
      break;
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

export async function sendPeriodicStats(): Promise<void> {
  const s = getStats();
  sendTelegram(
    `📊 Jogadores online: ${s.online} (humanos: ${s.humans}, bots: ${s.bots})\n` +
      `Distintos desde o início do monitor: ${s.distinctPlayersSeen}`,
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

  try {
    const players = await getPositions();
    const png = renderRadar(players);
    if (png)
      await sendTelegramPhoto(
        png,
        "🗺️ Radar (posição + direção)\n🔴▲ zumbi  🔵● humano",
      );
  } catch (err) {
    console.error("[radar] failed", err);
  }
}
