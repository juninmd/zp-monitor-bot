import { answerZombieQuestion } from "./agent/agent";
import { config } from "./config";
import { auditEvent, recentAudit } from "./database";
import { retrieveKnowledge } from "./knowledgeStore";
import { renderMapImage } from "./mapImage";
import { getMetrics } from "./metrics";
import { monitorState } from "./monitorState";
import { historyText } from "./notifier";
import { renderRadar } from "./radar";
import { getPositions, runRconCommand } from "./rcon";
import { sendTelegramPhotoTo, sendTelegramTo } from "./telegram";
import { parseTelegramCommand } from "./telegramCommands";

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from?: { id: number; username?: string; first_name?: string };
  };
}

interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

const HELP = `Comandos:
/status — servidor, mapa e jogadores
/stats — métricas do dia (kills, pico, distintos)
/ranking — ranking de 7 dias e recorde de pico
/radar — posição e direção dos jogadores
/mapa — print do mapa atual
/ask <pergunta> — dúvidas sobre Zombie Plague
/rcon status|stats|users|zp_telemetry_snapshot — console remoto auditado
/map <nome> — troca de mapa auditada
/audit — últimas ações`;

function actorName(update: TelegramUpdate): string {
  const from = update.message?.from;
  return from?.username ? `@${from.username}` : (from?.first_name ?? String(from?.id ?? "unknown"));
}

function statusText(): string {
  const info = monitorState.info;
  const telemetry = monitorState.telemetry;
  return [
    monitorState.connection.online ? "🟢 Servidor online" : "🔴 Servidor offline",
    info
      ? `Mapa: ${info.map} | Jogadores reais: ${info.players}/${info.maxplayers} (+${info.bots} bots) | Ping: ${info.ping ?? "—"} ms`
      : null,
    monitorState.rcon.fps !== null ? `⚡ FPS do servidor: ${monitorState.rcon.fps}` : null,
    telemetry.connected
      ? `Modo: ${telemetry.round?.mode ?? "—"} | 🧟 ${telemetry.zombies} x 🧍 ${telemetry.humans}`
      : "Telemetria ZP indisponível",
    monitorState.players.length
      ? `Online: ${monitorState.players.map((player) => player.name).join(", ")}`
      : "Sem jogadores humanos listados.",
  ]
    .filter(Boolean)
    .join("\n");
}

function statsText(): string {
  const metrics = getMetrics();
  const lines = [
    `📊 Métricas de hoje (${metrics.day})`,
    `🔫 Kills: ${metrics.kills} · 💀 Mortes: ${metrics.deaths}`,
    `👥 Pico de humanos online: ${metrics.peakHumans}`,
    `🆔 Jogadores distintos hoje: ${metrics.distinctHumans}`,
    `💬 Mensagens de chat: ${metrics.chatLines}`,
  ];
  if (metrics.topFraggers.length) {
    lines.push(
      `🥇 Top fraggers:\n${metrics.topFraggers.map((p) => `${p.name}: ${p.kills}`).join("\n")}`,
    );
  }
  if (metrics.topWeapons.length) {
    lines.push(`🔪 Armas: ${metrics.topWeapons.map(([w, n]) => `${w} ×${n}`).join(" · ")}`);
  }
  return lines.join("\n");
}

export async function handleTelegramText(
  text: string,
  chatId: string,
  actor: string,
): Promise<string | null> {
  const parsed = parseTelegramCommand(text);
  if (parsed.kind === "help" || parsed.kind === "unknown") {
    return HELP;
  }
  if (parsed.kind === "status") {
    return statusText();
  }
  if (parsed.kind === "stats") {
    return statsText();
  }
  if (parsed.kind === "ranking") {
    const lines = await historyText();
    return lines.length ? lines.join("\n") : "Sem histórico suficiente ainda.";
  }
  if (parsed.kind === "radar") {
    try {
      const players = await getPositions();
      const png = players.length > 0 ? renderRadar(players) : null;
      if (png) {
        await sendTelegramPhotoTo(
          chatId,
          png,
          "🗺️ Radar (posição + direção)\n🔴▲ zumbi  🔵● humano",
        );
        return null;
      }
      return "Sem jogadores para desenhar o radar.";
    } catch (error) {
      return `❌ Radar indisponível: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (parsed.kind === "map") {
    try {
      const map = monitorState.info?.map ?? "";
      const players = await getPositions();
      const png = map ? await renderMapImage(map, players) : null;
      if (png) {
        await sendTelegramPhotoTo(chatId, png, `🗺️ Print do mapa: ${map}\n🔴▲ zumbi  🔵● humano`);
        return null;
      }
      return map
        ? "Print do mapa indisponível (overview não acessível via kubectl)."
        : "Mapa desconhecido.";
    } catch (error) {
      return `❌ Print indisponível: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (parsed.kind === "audit") {
    const rows = await recentAudit();
    return rows.length
      ? rows
          .map(
            (row) =>
              `${row.created_at.toISOString()} ${row.status} ${row.action}: ${row.request.slice(0, 100)}`,
          )
          .join("\n")
      : "Auditoria vazia.";
  }
  if (parsed.kind === "rcon") {
    await auditEvent({
      chatId,
      actor,
      action: "command",
      request: parsed.command,
      status: "started",
    });
    try {
      const output = (await runRconCommand(parsed.command)).trim().slice(0, 3000);
      await auditEvent({
        chatId,
        actor,
        action: "command",
        request: parsed.command,
        response: output,
        status: "success",
      });
      return `✅ ${parsed.command}\n${output || "(sem saída)"}`;
    } catch (error) {
      const response = error instanceof Error ? error.message : String(error);
      await auditEvent({
        chatId,
        actor,
        action: "command",
        request: parsed.command,
        response,
        status: "failed",
      });
      return `❌ ${parsed.command}: ${response}`;
    }
  }

  await auditEvent({
    chatId,
    actor,
    action: "question",
    request: parsed.question,
    status: "started",
  });
  try {
    const context = await retrieveKnowledge(parsed.question);
    const answer = await answerZombieQuestion(chatId, parsed.question, context, actor);
    if (!answer) throw new Error("todos os modelos LiteLLM falharam");
    await auditEvent({
      chatId,
      actor,
      action: "question",
      request: parsed.question,
      response: answer,
      status: "success",
      metadata: { retrievedChunks: context.length, model: config.agentModels[0] },
    });
    return `🧟 ${answer}`;
  } catch (error) {
    const response = error instanceof Error ? error.message : String(error);
    await auditEvent({
      chatId,
      actor,
      action: "question",
      request: parsed.question,
      response,
      status: "failed",
    });
    return `❌ Não consegui responder agora: ${response}`;
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = String(message.chat.id);
  const actor = actorName(update);
  if (chatId !== config.telegramChatId) {
    await auditEvent({
      chatId,
      actor,
      action: "security",
      request: message.text.slice(0, 1000),
      response: "chat não autorizado",
      status: "denied",
    });
    return;
  }
  const reply = await handleTelegramText(message.text, chatId, actor);
  if (reply) await sendTelegramTo(chatId, reply);
}

export async function startTelegramBot(): Promise<void> {
  let offset = 0;
  while (true) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?timeout=30&offset=${offset}`,
        { signal: AbortSignal.timeout(35_000) },
      );
      if (!response.ok) throw new Error(`getUpdates HTTP ${response.status}`);
      const payload = (await response.json()) as TelegramUpdatesResponse;
      if (!payload.ok) throw new Error("getUpdates retornou ok=false");
      for (const update of payload.result) {
        offset = Math.max(offset, update.update_id + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("[telegram] polling error", error);
      await Bun.sleep(5000);
    }
  }
}
