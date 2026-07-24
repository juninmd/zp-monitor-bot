import { config } from "./config";

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

export async function getSnapshot(): Promise<Snapshot | null> {
  const raw = await runRconCommand("zp_telemetry_snapshot");
  const rm = raw.match(ROUND_RE);
  const cm = raw.match(COUNTS_RE);
  if (!rm || !cm) return null;

  const events: SnapshotEvent[] = [];
  for (const m of raw.matchAll(EVENT_RE)) {
    events.push({ kind: m[1], message: m[2], t: Number(m[3]) });
  }
  return {
    round: { phase: rm[1], mode: rm[2], elapsed: Number(rm[3]), timeLimit: Number(rm[4]) },
    zombies: Number(cm[1]),
    humans: Number(cm[2]),
    events,
  };
}

export async function getPositions(): Promise<RadarPlayer[]> {
  const raw = await runRconCommand("zp_telemetry_positions");

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

/**
 * Runs an arbitrary server console command over RCON via rcon.ps1.
 * `cmd` is passed as a single Bun.spawn arg (no shell involved), but the
 * HLDS console itself splits on `;` and doesn't strip quotes the way a shell
 * would - callers must sanitize any player-controlled text before it lands
 * here (see src/agent/tools.ts).
 */
export async function runRconCommand(cmd: string): Promise<string> {
  const proc = Bun.spawn(
    ["pwsh", "-NoProfile", "-File", config.rconScriptPath, "-Cmd", cmd],
    { stdout: "pipe", stderr: "pipe" },
  );
  const raw = await new Response(proc.stdout).text();
  await proc.exited;
  return raw;
}
