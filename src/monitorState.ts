import { GameDig, type QueryResult } from "gamedig";
import { samplePeakHumans } from "./metrics";
import type { Snapshot } from "./rcon";
import { parseStatus, type StatusClient, splitByStatus } from "./statusParser";

interface MonitorPlayer {
  name: string;
  score: number;
  time: number | null;
  /** Ping em ms, só quando a tabela `status` do RCON está disponível. */
  ping?: number | null;
}

// A `status` table older than this is ignored: bots churn with the quota, and
// a stale table would label a fresh human as a bot (or the reverse).
const STATUS_MAX_AGE_MS = 30_000;

export interface PlayerCounts {
  humans: number;
  bots: number;
  /** "status" = tabela RCON (confiável); "heuristic" = palpite do GameDig. */
  source: "status" | "heuristic";
}

/**
 * Fonte única da contagem de jogadores reais x bots. O log (state.ts) não serve:
 * o servidor não loga a saída dos bots na troca de mapa, então o contador
 * acumula bots fantasmas e perde quem já estava online antes do boot do bot.
 */
export function getPlayerCounts(): PlayerCounts | null {
  const info = monitorState.info;
  if (!info || !monitorState.connection.online) return null;
  return { humans: info.players, bots: info.bots, source: monitorState.playersSource };
}

interface MonitorState {
  connection: { online: boolean; lastError: string | null; lastUpdate: number | null };
  info: {
    name: string;
    map: string;
    players: number;
    maxplayers: number;
    bots: number;
    password: boolean;
    ping: number | null;
  } | null;
  /** Real players only. Bots are filtered out via the RCON `status` table. */
  players: MonitorPlayer[];
  /** How the split above was decided, so the UI can flag a degraded reading. */
  playersSource: "status" | "heuristic";
  rcon: {
    supported: boolean;
    fps: number | null;
    lastUpdate: number | null;
    lastError: string | null;
  };
  telemetry: {
    connected: boolean;
    lastError: string | null;
    round: Snapshot["round"] | null;
    zombies: number;
    humans: number;
    events: Snapshot["events"];
  };
  history: {
    t: number[];
    players: number[];
    zombies: number[];
    humans: number[];
    ping: Array<number | null>;
  };
}

export interface MonitorOptions {
  host: string;
  port: number;
  pollIntervalMs: number;
  rconIntervalMs: number;
  historyLength: number;
  rconEnabled: boolean;
}

export type RconRunner = (command: string) => Promise<string>;

export const monitorState: MonitorState = {
  connection: { online: false, lastError: null, lastUpdate: null },
  info: null,
  players: [],
  playersSource: "heuristic",
  rcon: { supported: false, fps: null, lastUpdate: null, lastError: null },
  telemetry: {
    connected: false,
    lastError: null,
    round: null,
    zombies: 0,
    humans: 0,
    events: [],
  },
  history: { t: [], players: [], zombies: [], humans: [], ping: [] },
};

// "CPU   In    Out   Uptime  Users   FPS    Players"
// "17.50  0.00  0.00      45     12  786.24        0"
// FPS is the 6th column, not the 1st - reading the 1st reported CPU% as if it
// were the engine framerate (17 instead of 786), which reads as a dying server.
const STATS_ROW_RE = /^\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s*$/m;

export function parseStatsFps(text: string): number | null {
  const match = text.match(STATS_ROW_RE);
  return match ? Number(match[6]) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushHistory(cap: number): void {
  const history = monitorState.history;
  history.t.push(Date.now());
  history.players.push(monitorState.info?.players ?? 0);
  history.zombies.push(monitorState.telemetry.zombies);
  history.humans.push(monitorState.telemetry.humans);
  history.ping.push(monitorState.info?.ping ?? null);
  if (history.t.length <= cap) return;
  history.t = history.t.slice(-cap);
  history.players = history.players.slice(-cap);
  history.zombies = history.zombies.slice(-cap);
  history.humans = history.humans.slice(-cap);
  history.ping = history.ping.slice(-cap);
}

export interface MonitorEvent {
  kind: "map_change" | "server_down" | "server_up";
  message: string;
  /** Mapa novo, só em map_change. */
  map?: string;
  /** Mapa que acabou, só em map_change. */
  from?: string;
  t: number;
}

export const monitorEvents: MonitorEvent[] = [];
const MONITOR_EVENTS_CAP = 50;

let lastOnline: boolean | null = null;
let lastMap = "";

/**
 * Eventos de transição detectados pelo polling (mapa trocou, servidor caiu/
 * voltou). O consumidor esvazia a fila; quem quiser latência, consome a cada
 * tick. Só transições emitem evento, então não há spam de repetição.
 */
export function consumeMonitorEvents(): MonitorEvent[] {
  const events = monitorEvents.splice(0, monitorEvents.length);
  return events;
}

function pushMonitorEvent(event: MonitorEvent): void {
  monitorEvents.push(event);
  if (monitorEvents.length > MONITOR_EVENTS_CAP) {
    monitorEvents.splice(0, monitorEvents.length - MONITOR_EVENTS_CAP);
  }
}

let lastStatus: { clients: StatusClient[]; at: number } | null = null;

function toMonitorPlayer(player: QueryResult["players"][number]): MonitorPlayer {
  const raw = player.raw as Record<string, unknown> | undefined;
  return {
    name: player.name || "(sem nome)",
    score: typeof raw?.score === "number" ? raw.score : (player.score ?? 0),
    time: typeof raw?.time === "number" ? raw.time : null,
  };
}

/**
 * GameDig knows HOW MANY bots there are (A2S_INFO carries the count) but not
 * WHICH ones: on GoldSrc it guesses by assuming the longest-connected clients
 * are the bots. Here that is backwards - the bots are recreated on every map
 * change while a real player's timer keeps running, so anyone who stays
 * through one map change is the oldest client on the server and gets labelled
 * a bot, with a bot promoted to "player" in their place.
 *
 * The RCON `status` table carries the actual BOT / STEAM_x id per client, so
 * use it whenever it is fresh and complete, and only fall back to GameDig's
 * guess when RCON is down.
 */
function resolvePlayers(result: QueryResult): {
  players: MonitorPlayer[];
  bots: number;
  source: MonitorState["playersSource"];
} {
  const listed = [...result.players, ...result.bots].map(toMonitorPlayer);
  const fresh =
    lastStatus && Date.now() - lastStatus.at <= STATUS_MAX_AGE_MS ? lastStatus.clients : [];
  const split = splitByStatus(listed, fresh);
  if (split) {
    // Consome um cliente da tabela por jogador para nicks repetidos.
    const pool = fresh.filter((client) => !client.isBot);
    const players = split.humans.map((player) => {
      const at = pool.findIndex((client) => client.name === player.name);
      const client = at >= 0 ? pool.splice(at, 1)[0] : undefined;
      return client ? { ...player, ping: client.ping } : player;
    });
    return { players, bots: split.bots.length, source: "status" };
  }
  return {
    players: result.players.map(toMonitorPlayer),
    bots: result.bots.length,
    source: "heuristic",
  };
}

async function pollA2s(options: MonitorOptions, broadcast: () => void): Promise<void> {
  try {
    const result = (await GameDig.query({
      type: "counterstrike16",
      host: options.host,
      port: options.port,
      socketTimeout: 2500,
      maxRetries: 1,
    })) as QueryResult;
    monitorState.connection.online = true;
    monitorState.connection.lastError = null;
    const resolved = resolvePlayers(result);
    monitorState.info = {
      name: result.name,
      map: result.map,
      players: resolved.players.length,
      maxplayers: result.maxplayers,
      bots: resolved.bots,
      password: result.password,
      ping: result.ping ?? null,
    };
    monitorState.players = resolved.players;
    monitorState.playersSource = resolved.source;
    samplePeakHumans(
      resolved.players.length,
      monitorState.telemetry.zombies,
      monitorState.info?.map ?? "",
    );
    if (lastOnline === false) {
      pushMonitorEvent({
        kind: "server_up",
        message: `Servidor voltou: ${result.name}`,
        t: Date.now(),
      });
    }
    if (lastMap && lastMap !== result.map) {
      pushMonitorEvent({
        kind: "map_change",
        message: `${lastMap} → ${result.map}`,
        map: result.map,
        from: lastMap,
        t: Date.now(),
      });
    }
    lastOnline = true;
    lastMap = result.map;
  } catch (error) {
    monitorState.connection.online = false;
    monitorState.connection.lastError = errorMessage(error);
    if (lastOnline !== false) {
      pushMonitorEvent({ kind: "server_down", message: errorMessage(error), t: Date.now() });
    }
    lastOnline = false;
  } finally {
    monitorState.connection.lastUpdate = Date.now();
    pushHistory(options.historyLength);
    broadcast();
  }
}

async function pollRcon(runRcon: RconRunner, broadcast: () => void): Promise<void> {
  try {
    monitorState.rcon.fps = parseStatsFps(await runRcon("stats"));
    lastStatus = { clients: parseStatus(await runRcon("status")), at: Date.now() };
    monitorState.rcon.lastError = null;
  } catch (error) {
    monitorState.rcon.lastError = errorMessage(error);
  } finally {
    monitorState.rcon.lastUpdate = Date.now();
    broadcast();
  }
}

async function pollTelemetry(runRcon: RconRunner, broadcast: () => void): Promise<void> {
  try {
    const reply = await runRcon("zp_telemetry_snapshot");
    const jsonStart = reply.indexOf("{");
    if (jsonStart < 0) throw new Error("zp_telemetry_snapshot sem JSON");
    const snapshot = JSON.parse(reply.slice(jsonStart)) as Snapshot;
    monitorState.telemetry.connected = true;
    monitorState.telemetry.lastError = null;
    monitorState.telemetry.round = snapshot.round;
    monitorState.telemetry.zombies = snapshot.zombies;
    monitorState.telemetry.humans = snapshot.humans;
    const known = new Set(
      monitorState.telemetry.events.map((event) => `${event.t}:${event.message}`),
    );
    const fresh = snapshot.events.filter((event) => !known.has(`${event.t}:${event.message}`));
    monitorState.telemetry.events = [...fresh.reverse(), ...monitorState.telemetry.events].slice(
      0,
      100,
    );
  } catch (error) {
    monitorState.telemetry.connected = false;
    monitorState.telemetry.lastError = errorMessage(error);
  } finally {
    broadcast();
  }
}

export function startMonitor(
  options: MonitorOptions,
  runRcon: RconRunner,
  broadcast: () => void,
): void {
  monitorState.rcon.supported = options.rconEnabled;
  void pollA2s(options, broadcast);
  setInterval(() => void pollA2s(options, broadcast), options.pollIntervalMs);
  if (!options.rconEnabled) return;
  void pollRcon(runRcon, broadcast);
  void pollTelemetry(runRcon, broadcast);
  setInterval(() => void pollRcon(runRcon, broadcast), options.rconIntervalMs);
  setInterval(() => void pollTelemetry(runRcon, broadcast), options.rconIntervalMs);
}
