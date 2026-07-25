import { GameDig, type QueryResult } from "gamedig";
import type { Snapshot } from "./rcon";

interface MonitorPlayer {
  name: string;
  score: number;
  time: number | null;
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
  players: MonitorPlayer[];
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

export function parseStatsFps(text: string): number | null {
  const match = text.match(/^\s*([\d.]+)\s/m);
  return match ? Number(match[1]) : null;
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
    monitorState.info = {
      name: result.name,
      map: result.map,
      players: result.players.length,
      maxplayers: result.maxplayers,
      bots: result.bots.length,
      password: result.password,
      ping: result.ping ?? null,
    };
    monitorState.players = result.players.map((player) => {
      const raw = player.raw as Record<string, unknown> | undefined;
      return {
        name: player.name || "(sem nome)",
        score: typeof raw?.score === "number" ? raw.score : (player.score ?? 0),
        time: typeof raw?.time === "number" ? raw.time : null,
      };
    });
  } catch (error) {
    monitorState.connection.online = false;
    monitorState.connection.lastError = errorMessage(error);
  } finally {
    monitorState.connection.lastUpdate = Date.now();
    pushHistory(options.historyLength);
    broadcast();
  }
}

async function pollRcon(runRcon: RconRunner, broadcast: () => void): Promise<void> {
  try {
    monitorState.rcon.fps = parseStatsFps(await runRcon("stats"));
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
