import { config } from "./config";
import { goldsrcRcon } from "./goldsrcRcon";

export interface RadarPlayer {
  team: "z" | "h";
  x: number;
  y: number;
  angle: number;
}

// GoldSrc RCON replies are hard-capped well under 1KB and can truncate
// mid-object. Extract whole {"t":..,"x":..,"y":..,"a":..} objects instead of
// JSON.parse-ing the whole payload, so a cut-off tail just drops the last
// (incomplete) player instead of losing everyone.
const PLAYER_RE = /\{"t":"([zh])","x":(-?\d+),"y":(-?\d+),"a":(-?\d+)\}/g;

export interface SnapshotEvent {
  kind: string;
  message: string;
  t: number;
}

export interface Snapshot {
  round: { phase: string; mode: string; elapsed: number; timeLimit: number };
  zombies: number;
  humans: number;
  events: SnapshotEvent[];
}

// Same truncation caveat as positions: the reply can be cut mid-object. The
// round header is small and always intact; we JSON.parse the header fields via
// regex and salvage whatever whole event objects survived.
const ROUND_RE =
  /"round":\{"phase":"([^"]*)","mode":"([^"]*)","elapsed":(-?\d+),"timeLimit":(-?\d+)\}/;
const COUNTS_RE = /"zombies":(\d+),"humans":(\d+)/;
const EVENT_RE = /\{"kind":"([^"]*)","message":"([^"]*)","t":(\d+)\}/g;

export function parseSnapshotReply(raw: string): Snapshot | null {
  const rm = raw.match(ROUND_RE);
  const cm = raw.match(COUNTS_RE);
  if (!rm || !cm) return null;

  const events: SnapshotEvent[] = [];
  for (const m of raw.matchAll(EVENT_RE)) {
    events.push({ kind: m[1] ?? "", message: m[2] ?? "", t: Number(m[3]) });
  }
  return {
    round: {
      phase: rm[1] ?? "",
      mode: rm[2] ?? "",
      elapsed: Number(rm[3]),
      timeLimit: Number(rm[4]),
    },
    zombies: Number(cm[1]),
    humans: Number(cm[2]),
    events,
  };
}

export async function getSnapshot(): Promise<Snapshot | null> {
  return parseSnapshotReply(await runRconCommand("zp_telemetry_snapshot"));
}

export function parsePositionsReply(raw: string): RadarPlayer[] {
  const players: RadarPlayer[] = [];
  for (const m of raw.matchAll(PLAYER_RE)) {
    players.push({
      team: m[1] as "z" | "h",
      x: Number(m[2]),
      y: Number(m[3]),
      angle: Number(m[4]),
    });
  }
  return players;
}

export async function getPositions(): Promise<RadarPlayer[]> {
  return parsePositionsReply(await runRconCommand("zp_telemetry_positions"));
}

export async function runRconCommand(cmd: string): Promise<string> {
  if (!config.rconPassword) throw new Error("RCON_PASSWORD não configurado");
  return goldsrcRcon(
    config.serverHost,
    config.serverPort,
    config.rconPassword,
    cmd,
    config.rconTimeoutMs,
  );
}
