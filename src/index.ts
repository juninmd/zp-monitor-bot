import { Elysia } from "elysia";
import { config } from "./config";
import { databaseHealth, initializeDatabase } from "./database";
import { ingestKnowledgeDirectory } from "./knowledgeStore";
import { startLogTail } from "./logTail";
import { monitorState, startMonitor } from "./monitorState";
import { handleEvent, sendPeriodicStats } from "./notifier";
import { runRconCommand } from "./rcon";
import { getStats } from "./state";
import { sendTelegram } from "./telegram";
import { startTelegramBot } from "./telegramBot";

let ready = false;
let knowledgeChunks = 0;

const app = new Elysia()
  .get("/", () => Bun.file("public/index.html"))
  .get("/health", async ({ set }) => {
    const database = await databaseHealth().catch(() => false);
    const ok = ready && database;
    if (!ok) set.status = 503;
    return { ok, database, knowledgeChunks };
  })
  .get("/stats", () => getStats())
  .get("/api/state", () => monitorState)
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
  knowledgeChunks = await ingestKnowledgeDirectory();
  ready = true;
  console.log(
    `[monitor-bot] http://0.0.0.0:${app.server?.port} | knowledge_ingested=${knowledgeChunks}`,
  );
  sendTelegram(`🤖 Monitor ZP iniciado: A2S, RCON, RAG/pgvector e auditoria ativos.`);
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
  setInterval(() => void sendPeriodicStats(), config.statsIntervalMin * 60 * 1000);
}

bootstrap().catch((error) => {
  console.error("[bootstrap] fatal", error);
  process.exitCode = 1;
  app.stop();
});
