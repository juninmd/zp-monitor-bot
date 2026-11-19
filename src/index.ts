import { timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { config } from "./config";
import { databaseHealth, initializeDatabase, pruneOldRecords, recentAudit } from "./database";
import { getRtvStatus } from "./inGameCommands";
import { ingestKnowledgeDirectory, knowledgeStats, listKnowledgeSources } from "./knowledgeStore";
import { startLogTail } from "./logTail";
import { renderHeatmapImage, renderOverviewBase } from "./mapImage";
import { checkMapRotation } from "./mapRotation";
import { getMetrics, hydrateMetrics } from "./metrics";
import {
  loadHeatmapPoints,
  loadPeakRecord,
  loadPlayerSummary,
  loadRanking,
  loadRecentPresence,
  loadTodayPlayers,
} from "./metricsQueries";
import { flushKills, initializeMetricsTables } from "./metricsStore";
import { monitorState, seedMonitorHistory, setWsClientCount, startMonitor } from "./monitorState";
import { handleEvent, handleMonitorEvents } from "./notifier";
import { syncPodKnowledge } from "./podKnowledge";
import { formatPrometheusMetrics } from "./prometheus";
import { runRconCommand } from "./rcon";
import { getStats } from "./state";
import { cleanSteamIdParam, describeSteamId } from "./steamId";
import { getSteamProfile } from "./steamProfile";
import { getSteamSignals } from "./steamSignals";
import { buildTodaySummaryData, renderSummaryCard } from "./summaryCard";
import { handleTelegramText, startTelegramBot } from "./telegramBot";
import { evaluateTrust, getRecentKillsPerMin } from "./trustScore";

let ready = false;
let knowledgeChunks = 0;
let podSyncResult = { filesRead: 0, chunksIndexed: 0 };
const startedAt = Date.now();
const MAP_TOKEN_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function cleanMapParam(raw: string): string | null {
  return MAP_TOKEN_RE.test(raw) ? raw : null;
}

function authorized(request: Request): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = config.telegramBotToken;
  return (
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
}

let activeWsCount = 0;

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
      podKnowledgeSync: podSyncResult,
      knowledge: database ? await knowledgeStats() : null,
    };
  })
  .get("/metrics", ({ set }) => {
    set.headers["content-type"] = "text/plain; version=0.0.4; charset=utf-8";
    return formatPrometheusMetrics(Math.round((Date.now() - startedAt) / 1000));
  })
  .get("/stats", () => getStats())
  .get("/api/state", () => monitorState)
  .get("/api/today", async () => {
    const [players, ranking, peak] = await Promise.all([
      loadTodayPlayers(),
      loadRanking(7, 5),
      loadPeakRecord(),
    ]);
    return {
      players,
      ranking,
      peak,
      metrics: getMetrics(),
      rtv: getRtvStatus(),
    };
  })
  .get("/api/audit", async () => {
    const rows = await recentAudit(20);
    return {
      events: rows.map((r) => ({
        actor: r.actor,
        action: r.action,
        request: r.request,
        status: r.status,
        createdAt: r.created_at,
      })),
    };
  })
  .get("/api/rag", async () => ({
    stats: await knowledgeStats().catch(() => null),
    sources: await listKnowledgeSources().catch(() => []),
  }))
  .get("/api/map/meta/:map", async ({ params, set }) => {
    const map = cleanMapParam(params.map);
    if (!map) {
      set.status = 400;
      return { error: "invalid map" };
    }
    const [base, heatmap] = await Promise.all([
      renderOverviewBase(map),
      loadHeatmapPoints(map, 14),
    ]);
    return {
      map,
      available: Boolean(base),
      overview: base?.overview ?? null,
      width: base?.width ?? 640,
      height: base?.height ?? 640,
      imageUrl: base ? `/api/map/image/${encodeURIComponent(map)}` : null,
      heatmap,
    };
  })
  .get("/api/map/image/:map", async ({ params, set }) => {
    const map = cleanMapParam(params.map);
    if (!map) {
      set.status = 400;
      return { error: "invalid map" };
    }
    const base = await renderOverviewBase(map);
    if (!base) {
      set.status = 404;
      return { error: "overview unavailable" };
    }
    return new Response(new Uint8Array(base.png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=300",
      },
    });
  })
  .get("/api/map/heatmap/:map/image.png", async ({ params, set }) => {
    const map = cleanMapParam(params.map);
    if (!map) {
      set.status = 400;
      return { error: "invalid map" };
    }
    const points = await loadHeatmapPoints(map, 14);
    const png = await renderHeatmapImage(map, points);
    if (!png) {
      set.status = 404;
      return { error: "no heatmap points" };
    }
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-cache" },
    });
  })
  .get("/api/summary.png", async () => {
    const png = await renderSummaryCard(await buildTodaySummaryData());
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-cache" },
    });
  })
  .get("/api/player/:steamId", async ({ params, set }) => {
    const steamId = cleanSteamIdParam(params.steamId);
    if (!steamId) {
      set.status = 400;
      return { error: "invalid steamId" };
    }
    const steam = describeSteamId(steamId);
    const [summary, profile, signals] = await Promise.all([
      loadPlayerSummary(steamId),
      getSteamProfile(steam.steam64).catch(() => null),
      getSteamSignals(steam.steam64).catch(() => null),
    ]);
    const trust = evaluateTrust({
      origin: steam.origin,
      signals,
      previousNamesCount: summary.previousNames.length,
      visits: summary.visits,
      recentKillsPerMin: getRecentKillsPerMin(steamId),
    });
    return {
      steamId,
      origin: steam.origin,
      profileUrl: steam.profileUrl,
      avatarUrl: profile?.avatarUrl ?? null,
      profileName: profile?.profileName ?? null,
      summary,
      signals,
      trust,
    };
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
      activeWsCount += 1;
      setWsClientCount(activeWsCount);
      ws.subscribe("state");
      ws.send(JSON.stringify({ type: "state", data: monitorState }));
    },
    close() {
      activeWsCount = Math.max(0, activeWsCount - 1);
      setWsClientCount(activeWsCount);
    },
  })
  .listen(config.port);

function broadcastState(): void {
  if (activeWsCount === 0) return;
  app.server?.publish("state", JSON.stringify({ type: "state", data: monitorState }));
}

async function bootstrap(): Promise<void> {
  await initializeDatabase();
  await initializeMetricsTables();
  // Reidrata o dia e a série recente antes de anunciar boot: um restart no meio
  // da noite não pode reportar "0 kills hoje" nem gráfico vazio.
  await hydrateMetrics();
  const recentPresence = await loadRecentPresence(config.historyLength);
  if (recentPresence.length > 0) {
    seedMonitorHistory(recentPresence, config.historyLength);
  }
  knowledgeChunks = await ingestKnowledgeDirectory();
  ready = true;
  console.log(
    `[monitor-bot] http://0.0.0.0:${app.server?.port} | knowledge_ingested=${knowledgeChunks}`,
  );
  // Sincronização viva das configs do pod e limpeza de retenção em background.
  void syncPodKnowledge().then((r) => {
    podSyncResult = r;
  });
  void pruneOldRecords();
  setInterval(() => void pruneOldRecords(), 24 * 60 * 60 * 1000);

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
