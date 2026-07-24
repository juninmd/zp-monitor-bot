import { Elysia } from "elysia";
import { config } from "./config";
import { startLogTail } from "./logTail";
import { handleEvent, sendPeriodicStats } from "./notifier";
import { sendTelegram } from "./telegram";
import { getStats } from "./state";

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .get("/stats", () => getStats())
  .listen(config.port);

console.log(`[monitor-bot] http://localhost:${app.server?.port}`);

sendTelegram(
  `🤖 Monitor CS 1.6 iniciado (namespace ${config.namespace}, pod ${config.podSelector}).`,
);

void startLogTail(handleEvent);

setInterval(sendPeriodicStats, config.statsIntervalMin * 60 * 1000);
