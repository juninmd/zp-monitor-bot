import { answerZombieQuestion } from "./agent/agent";
import { config } from "./config";
import { auditEvent, recentAudit } from "./database";
import { retrieveKnowledge } from "./knowledgeStore";
import { monitorState } from "./monitorState";
import { runRconCommand } from "./rcon";
import { sendTelegramTo } from "./telegram";
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
      ? `Mapa: ${info.map} | Jogadores: ${info.players}/${info.maxplayers} | Ping: ${info.ping ?? "—"} ms`
      : null,
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

  const parsed = parseTelegramCommand(message.text);
  if (parsed.kind === "help" || parsed.kind === "unknown") {
    await sendTelegramTo(chatId, HELP);
    return;
  }
  if (parsed.kind === "status") {
    await sendTelegramTo(chatId, statusText());
    return;
  }
  if (parsed.kind === "audit") {
    const rows = await recentAudit();
    const text = rows.length
      ? rows
          .map(
            (row) =>
              `${row.created_at.toISOString()} ${row.status} ${row.action}: ${row.request.slice(0, 100)}`,
          )
          .join("\n")
      : "Auditoria vazia.";
    await sendTelegramTo(chatId, text);
    return;
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
      await sendTelegramTo(chatId, `✅ ${parsed.command}\n${output || "(sem saída)"}`);
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
      await sendTelegramTo(chatId, `❌ ${parsed.command}: ${response}`);
    }
    return;
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
    const answer = await answerZombieQuestion(chatId, parsed.question, context);
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
    await sendTelegramTo(chatId, `🧟 ${answer}`);
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
    await sendTelegramTo(chatId, `❌ Não consegui responder agora: ${response}`);
  }
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
