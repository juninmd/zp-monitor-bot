/**
 * Persistência das métricas de jogo. O agregado do dia vivia só em memória e
 * zerava a cada restart do pod; aqui cada kill vira linha e as agregações
 * (dia, ranking da semana, recorde de pico) saem de SQL.
 *
 * Escrita é best-effort e em lote: perder uma métrica nunca pode derrubar o
 * monitor nem atrasar o parser de log.
 */

import { database } from "./database";

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_MAX_ROWS = 50;
const PRESENCE_SAMPLE_MS = 60_000;

export interface KillRow {
  killerName: string;
  killerSteamId: string;
  victimName: string;
  victimSteamId: string;
  weapon: string;
  map?: string;
  killerX?: number | null;
  killerY?: number | null;
  killerZ?: number | null;
  victimX?: number | null;
  victimY?: number | null;
  victimZ?: number | null;
}

export interface HeatmapPoint {
  x: number;
  y: number;
  weapon: string;
  kind: "victim" | "killer";
}

export interface DailyTotals {
  kills: number;
  deaths: number;
  peakHumans: number;
  /** SteamIDs distintos do dia, para semear o Set em memória sem divergir. */
  distinctHumans: string[];
  fraggers: Array<{ steamId: string; name: string; kills: number; deaths: number }>;
  weapons: Array<[string, number]>;
}

const LIVE_HEATMAP_CAP = 500;
const liveHeatmap = new Map<string, HeatmapPoint[]>();

export function recordLiveHeatmapKill(kill: KillRow): void {
  const map = kill.map?.trim();
  if (!map || kill.victimX == null || kill.victimY == null) return;
  const list = liveHeatmap.get(map) ?? [];
  list.push({ x: kill.victimX, y: kill.victimY, weapon: kill.weapon, kind: "victim" });
  if (list.length > LIVE_HEATMAP_CAP) list.splice(0, list.length - LIVE_HEATMAP_CAP);
  liveHeatmap.set(map, list);
}

export function getLiveHeatmap(map: string): HeatmapPoint[] {
  return liveHeatmap.get(map) ?? [];
}

export async function initializeMetricsTables(): Promise<void> {
  if (!database) return;
  await database`
    CREATE TABLE IF NOT EXISTS kill_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      killer_steam_id text NOT NULL,
      killer_name text NOT NULL,
      victim_steam_id text NOT NULL,
      victim_name text NOT NULL,
      weapon text NOT NULL,
      map text,
      killer_x integer,
      killer_y integer,
      killer_z integer,
      victim_x integer,
      victim_y integer,
      victim_z integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS map text`;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS killer_x integer`;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS killer_y integer`;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS killer_z integer`;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS victim_x integer`;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS victim_y integer`;
  await database`ALTER TABLE kill_events ADD COLUMN IF NOT EXISTS victim_z integer`;
  await database`CREATE INDEX IF NOT EXISTS kill_events_created_at_idx ON kill_events (created_at DESC)`;
  await database`CREATE INDEX IF NOT EXISTS kill_events_map_idx ON kill_events (map, created_at DESC)`;
  // Amostra de presença: 1/min é o suficiente para pico, horário nobre e
  // retenção, sem inflar a tabela como o polling de 3s faria.
  await database`
    CREATE TABLE IF NOT EXISTS presence_samples (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      map text NOT NULL,
      humans integer NOT NULL,
      zombies integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await database`CREATE INDEX IF NOT EXISTS presence_samples_created_at_idx ON presence_samples (created_at DESC)`;
}

let pending: KillRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  if (!database || pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    await database`
      INSERT INTO kill_events (
        killer_steam_id, killer_name, victim_steam_id, victim_name, weapon,
        map, killer_x, killer_y, killer_z, victim_x, victim_y, victim_z
      )
      SELECT * FROM UNNEST(
        ${batch.map((k) => k.killerSteamId)}::text[],
        ${batch.map((k) => k.killerName)}::text[],
        ${batch.map((k) => k.victimSteamId)}::text[],
        ${batch.map((k) => k.victimName)}::text[],
        ${batch.map((k) => k.weapon)}::text[],
        ${batch.map((k) => k.map ?? null)}::text[],
        ${batch.map((k) => k.killerX ?? null)}::integer[],
        ${batch.map((k) => k.killerY ?? null)}::integer[],
        ${batch.map((k) => k.killerZ ?? null)}::integer[],
        ${batch.map((k) => k.victimX ?? null)}::integer[],
        ${batch.map((k) => k.victimY ?? null)}::integer[],
        ${batch.map((k) => k.victimZ ?? null)}::integer[]
      )
    `;
  } catch (error) {
    console.error("[metricsStore] flush de kills falhou", error);
  }
}

/** Enfileira uma kill entre humanos. Sem banco, guarda apenas no heatmap vivo. */
export function enqueueKill(kill: KillRow): void {
  recordLiveHeatmapKill(kill);
  if (!database) return;
  pending.push(kill);
  if (pending.length >= FLUSH_MAX_ROWS) {
    void flush();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
}

export async function flushKills(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  await flush();
}

let lastPresenceAt = 0;

/** Amostra a presença, no máximo uma vez por minuto. */
export function samplePresence(map: string, humans: number, zombies: number): void {
  if (!database) return;
  const now = Date.now();
  if (now - lastPresenceAt < PRESENCE_SAMPLE_MS) return;
  lastPresenceAt = now;
  database`
    INSERT INTO presence_samples (map, humans, zombies)
    VALUES (${map}, ${humans}, ${zombies})
  `.catch((error: unknown) => console.error("[metricsStore] sample falhou", error));
}
