import { timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { config } from "./config";
import { databaseHealth, initializeDatabase } from "./database";
import { ingestKnowledgeDirectory, knowledgeStats } from "./knowledgeStore";
import { startLogTail } from "./logTail";
import { checkMapRotation } from "./mapRotation";
import { hydrateMetrics } from "./metrics";
import { loadPeakRecord, loadRanking, loadTodayPlayers } from "./metricsQueries";
import { flushKills, initializeMetricsTables } from "./metricsStore";
import { monitorState, startMonitor } from "./monitorState";
import { handleEvent, handleMonitorEvents } from "./notifier";
import { runRconCommand } from "./rcon";
import { getStats } from "./state";
import { handleTelegramText, startTelegramBot } from "./telegramBot";

let ready = false;
let knowledgeChunks = 0;
const startedAt = Date.now();

function authorized(request: Request): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = config.telegramBotToken;
  return (
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
}

const app = new Elysia()
  .get("/", () => Bun.file("public/index.html"))
  .get("/health", async ({ set }) => {
    const database = await databaseHealth().catch(() => false);
    const ok = ready && database;
    if (!ok) set.status = 503;
    return {
      ok,
      database,
      revision: process.env.GIT_SHA ?? "dev",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      knowledgeIngestedAtBoot: knowledgeChunks,
      knowledge: database ? await knowledgeStats() : null,
    };
  })
  .get("/stats", () => getStats())
  .get("/api/state", () => monitorState)
  .get("/api/today", async () => {
    const [players, ranking, peak] = await Promise.all([
      loadTodayPlayers(),
      loadRanking(7, 5),
      loadPeakRecord(),
    ]);
    return { players, ranking, peak };
  })
  .post("/api/telegram", async ({ body, request, set }) => {
    if (!authorized(request)) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("text" in body) ||
      typeof body.text !== "string" ||
      !body.text.trim()
    ) {
      set.status = 400;
      return { error: "text is required" };
    }
    const chatId =
      "chatId" in body && typeof body.chatId === "string" ? body.chatId : config.telegramChatId;
    const actor = "actor" in body && typeof body.actor === "string" ? body.actor : "telegram-hub";
    return {
      reply: await handleTelegramText(body.text.slice(0, 1000), chatId, actor.slice(0, 100)),
    };
  })
  .ws("/ws", {
    open(ws) {
      ws.subscribe("state");
      ws.send(JSON.stringify({ type: "state", data: monitorState }));
    },
  })
  .listen(config.port);

function broadcastState(): void {
  app.server?.publish("state", JSON.stringify({ type: "state", data: monitorState }));
}

async function bootstrap(): Promise<void> {
  await initializeDatabase();
  await initializeMetricsTables();
  // Reidrata o dia antes de anunciar boot: um restart no meio da noite não
  // pode reportar "0 kills hoje" com o servidor cheio.
  await hydrateMetrics();
  knowledgeChunks = await ingestKnowledgeDirectory();
  ready = true;
  console.log(
    `[monitor-bot] http://0.0.0.0:${app.server?.port} | knowledge_ingested=${knowledgeChunks}`,
  );
  startMonitor(
    {
      host: config.serverHost,
      port: config.serverPort,
      pollIntervalMs: config.pollIntervalMs,
      rconIntervalMs: config.rconIntervalMs,
      historyLength: config.historyLength,
      rconEnabled: Boolean(config.rconPassword),
    },
    runRconCommand,
    broadcastState,
  );
  if (config.logTailEnabled) void startLogTail(handleEvent);
  if (config.telegramPollingEnabled) void startTelegramBot();
  // Transições detectadas pelo polling (mapa trocou, servidor caiu/voltou).
  setInterval(() => handleMonitorEvents(), 2000);
  // Rotação automática de mapa vazio: checagem a cada 60s basta (limiar é em minutos).
  setInterval(() => void checkMapRotation(), 60_000);
}

// Kills ficam até 10s em buffer: descarrega antes do pod morrer. Marcar
// ready=false tira o pod do balanceamento (readiness 503) durante o dreno.
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  await flushKills().catch(() => {});
  try {
    await app.stop();
  } catch {}
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown().finally(() => process.exit(0)));
}

bootstrap().catch((error) => {
  console.error("[bootstrap] fatal", error);
  process.exitCode = 1;
  app.stop();
});
