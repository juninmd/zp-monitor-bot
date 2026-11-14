/**
 * Agregações das métricas persistidas. O corte de dia é o de America/Sao_Paulo,
 * o mesmo que o agregado em memória usa, para os dois números baterem.
 */

import { database } from "./database";
import { type DailyTotals, getLiveHeatmap, type HeatmapPoint } from "./metricsStore";

const BR_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Instante da meia-noite BR de hoje. O Brasil não tem horário de verão desde
 * 2019, então o offset fixo -03:00 é exato e evita montar SQL por concatenação.
 */
export function brDayStart(now = new Date()): Date {
  return new Date(`${BR_DAY.format(now)}T00:00:00-03:00`);
}

interface CountRow {
  kills: number | string | null;
  deaths: number | string | null;
}

const int = (value: unknown): number => Number(value ?? 0);

/** Totais do dia corrente, para reidratar o agregado em memória no boot. */
export async function loadDailyTotals(): Promise<DailyTotals | null> {
  if (!database) return null;
  const dayStart = brDayStart();
  try {
    const [totals] = await database<CountRow[]>`
      SELECT count(*) FILTER (
               WHERE killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
             ) AS kills,
             count(*) FILTER (WHERE victim_steam_id <> 'BOT') AS deaths
        FROM kill_events
       WHERE created_at >= ${dayStart}
    `;
    const fraggers = await database<
      Array<{ steam_id: string; name: string; kills: number | string; deaths: number | string }>
    >`
      SELECT steam_id,
             (array_agg(name ORDER BY at DESC))[1] AS name,
             sum(kills)::int AS kills,
             sum(deaths)::int AS deaths
        FROM (
          SELECT killer_steam_id AS steam_id, killer_name AS name, created_at AS at,
                 1 AS kills, 0 AS deaths
            FROM kill_events
           WHERE created_at >= ${dayStart}
             AND killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
          UNION ALL
          SELECT victim_steam_id, victim_name, created_at, 0, 1
            FROM kill_events
           WHERE created_at >= ${dayStart}
             AND victim_steam_id <> 'BOT'
        ) AS rows
       GROUP BY steam_id
       ORDER BY sum(kills) DESC
    `;
    const weapons = await database<Array<{ weapon: string; total: number | string }>>`
      SELECT weapon, count(*)::int AS total
        FROM kill_events
       WHERE created_at >= ${dayStart}
         AND killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
         AND weapon <> ''
       GROUP BY weapon
       ORDER BY count(*) DESC
    `;
    const [peak] = await database<Array<{ peak: number | string | null }>>`
      SELECT max(humans) AS peak FROM presence_samples
       WHERE created_at >= ${dayStart}
    `;
    const distinct = await database<Array<{ steam_id: string }>>`
      SELECT DISTINCT steam_id FROM player_sessions
       WHERE connected_at >= ${dayStart}
    `;
    return {
      kills: int(totals?.kills),
      deaths: int(totals?.deaths),
      peakHumans: int(peak?.peak),
      distinctHumans: distinct.map((row) => row.steam_id),
      fraggers: fraggers
        .filter((f) => int(f.kills) > 0)
        .map((f) => ({
          steamId: f.steam_id,
          name: f.name,
          kills: int(f.kills),
          deaths: int(f.deaths),
        })),
      weapons: weapons.map((w) => [w.weapon, int(w.total)] as [string, number]),
    };
  } catch (error) {
    console.error("[metricsQueries] loadDailyTotals falhou", error);
    return null;
  }
}

export interface RankingEntry {
  steamId?: string;
  name: string;
  kills: number;
}

/** Ranking de frags dos últimos `days` dias, agrupado por conta. */
export async function loadRanking(days: number, limit = 10): Promise<RankingEntry[]> {
  if (!database) return [];
  try {
    const rows = await database<Array<{ steam_id: string; name: string; kills: number | string }>>`
      SELECT killer_steam_id AS steam_id,
             (array_agg(killer_name ORDER BY created_at DESC))[1] AS name,
             count(*)::int AS kills
        FROM kill_events
       WHERE created_at >= now() - make_interval(days => ${days})
         AND killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
       GROUP BY killer_steam_id
       ORDER BY count(*) DESC
       LIMIT ${limit}
    `;
    return rows.map((r) => ({ steamId: r.steam_id, name: r.name, kills: int(r.kills) }));
  } catch (error) {
    console.error("[metricsQueries] loadRanking falhou", error);
    return [];
  }
}

export interface TodayPlayer {
  steamId: string;
  name: string;
  countryCode: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
  durationSeconds: number | null;
}

/** Sessões de jogadores reais de hoje (dia BR), para o painel "Hoje" do dashboard. */
export async function loadTodayPlayers(): Promise<TodayPlayer[]> {
  if (!database) return [];
  try {
    const rows = await database<
      Array<{
        steam_id: string;
        name: string;
        country_code: string | null;
        connected_at: Date;
        disconnected_at: Date | null;
        duration_seconds: number | string | null;
      }>
    >`
      SELECT steam_id, name, country_code, connected_at, disconnected_at, duration_seconds
        FROM player_sessions
       WHERE connected_at >= ${brDayStart()}
       ORDER BY connected_at ASC
    `;
    return rows.map((r) => ({
      steamId: r.steam_id,
      name: r.name,
      countryCode: r.country_code,
      connectedAt: r.connected_at,
      disconnectedAt: r.disconnected_at,
      durationSeconds: r.duration_seconds == null ? null : int(r.duration_seconds),
    }));
  } catch (error) {
    console.error("[metricsQueries] loadTodayPlayers falhou", error);
    return [];
  }
}

/** Recorde histórico de humanos simultâneos e quando aconteceu. */
export async function loadPeakRecord(): Promise<{ humans: number; at: Date } | null> {
  if (!database) return null;
  try {
    const [row] = await database<Array<{ humans: number | string; created_at: Date }>>`
      SELECT humans, created_at FROM presence_samples
       ORDER BY humans DESC, created_at ASC
       LIMIT 1
    `;
    if (!row || int(row.humans) === 0) return null;
    return { humans: int(row.humans), at: row.created_at };
  } catch (error) {
    console.error("[metricsQueries] loadPeakRecord falhou", error);
    return null;
  }
}

/** Amostras recentes de presença para reidratar o gráfico do dashboard no boot. */
export async function loadRecentPresence(
  limit = 360,
): Promise<Array<{ t: number; humans: number; zombies: number }>> {
  if (!database) return [];
  try {
    const rows = await database<Array<{ created_at: Date; humans: number; zombies: number }>>`
      SELECT created_at, humans, zombies
        FROM presence_samples
       ORDER BY created_at DESC
       LIMIT ${limit}
    `;
    return rows.reverse().map((r) => ({
      t: new Date(r.created_at).getTime(),
      humans: int(r.humans),
      zombies: int(r.zombies),
    }));
  } catch (error) {
    console.warn("[metricsQueries] loadRecentPresence falhou", error);
    return [];
  }
}

/** Mapa com maior número de amostras com humanos hoje. */
export async function loadTopMapToday(): Promise<string | null> {
  if (!database) return null;
  try {
    const [row] = await database<Array<{ map: string }>>`
      SELECT map
        FROM presence_samples
       WHERE created_at >= ${brDayStart()} AND map <> ''
       GROUP BY map
       ORDER BY sum(GREATEST(humans, 1)) DESC
       LIMIT 1
    `;
    return row?.map ?? null;
  } catch {
    return null;
  }
}

/** Pontos de kills/infecções para gerar o heatmap de um mapa. */
export async function loadHeatmapPoints(map: string, days = 14): Promise<HeatmapPoint[]> {
  const live = getLiveHeatmap(map);
  if (!database || !map) return live;
  try {
    const rows = await database<Array<{ victim_x: number; victim_y: number; weapon: string }>>`
      SELECT victim_x, victim_y, weapon
        FROM kill_events
       WHERE map = ${map}
         AND victim_x IS NOT NULL
         AND victim_y IS NOT NULL
         AND created_at >= now() - make_interval(days => ${days})
       ORDER BY created_at DESC
       LIMIT 1000
    `;
    const fromDb: HeatmapPoint[] = rows.map((r) => ({
      x: int(r.victim_x),
      y: int(r.victim_y),
      weapon: r.weapon,
      kind: "victim",
    }));
    // Combina buffer em memória (ainda não descarregado) com o histórico do banco.
    return [...live, ...fromDb].slice(0, 1200);
  } catch (error) {
    console.warn("[metricsQueries] loadHeatmapPoints falhou", error);
    return live;
  }
}

export interface PlayerRivals {
  fregues: { name: string; kills: number } | null;
  algoz: { name: string; deaths: number } | null;
}

export async function loadTopRivals(steamId: string, days = 7): Promise<PlayerRivals> {
  if (!database || !steamId) return { fregues: null, algoz: null };
  try {
    const [fregues] = await database<Array<{ name: string; total: number | string }>>`
      SELECT (array_agg(victim_name ORDER BY created_at DESC))[1] AS name,
             count(*)::int AS total
        FROM kill_events
       WHERE killer_steam_id = ${steamId}
         AND victim_steam_id <> 'BOT'
         AND created_at >= now() - make_interval(days => ${days})
       GROUP BY victim_steam_id
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    const [algoz] = await database<Array<{ name: string; total: number | string }>>`
      SELECT (array_agg(killer_name ORDER BY created_at DESC))[1] AS name,
             count(*)::int AS total
        FROM kill_events
       WHERE victim_steam_id = ${steamId}
         AND killer_steam_id <> 'BOT'
         AND created_at >= now() - make_interval(days => ${days})
       GROUP BY killer_steam_id
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    return {
      fregues: fregues ? { name: fregues.name, kills: int(fregues.total) } : null,
      algoz: algoz ? { name: algoz.name, deaths: int(algoz.total) } : null,
    };
  } catch {
    return { fregues: null, algoz: null };
  }
}

export interface PlayerRankInfo {
  rank: number | null;
  totalRanked: number;
  kills: number;
  deaths: number;
}

export async function loadPlayerRank(steamId: string, days = 7): Promise<PlayerRankInfo> {
  if (!database || !steamId) return { rank: null, totalRanked: 0, kills: 0, deaths: 0 };
  try {
    const board = await database<Array<{ steam_id: string; kills: number | string }>>`
      SELECT killer_steam_id AS steam_id, count(*)::int AS kills
        FROM kill_events
       WHERE created_at >= now() - make_interval(days => ${days})
         AND killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
       GROUP BY killer_steam_id
       ORDER BY count(*) DESC
    `;
    const [deathRow] = await database<Array<{ deaths: number | string }>>`
      SELECT count(*)::int AS deaths
        FROM kill_events
       WHERE victim_steam_id = ${steamId}
         AND created_at >= now() - make_interval(days => ${days})
    `;
    const idx = board.findIndex((row) => row.steam_id === steamId);
    return {
      rank: idx >= 0 ? idx + 1 : null,
      totalRanked: board.length,
      kills: idx >= 0 ? int(board[idx]?.kills) : 0,
      deaths: int(deathRow?.deaths),
    };
  } catch {
    return { rank: null, totalRanked: 0, kills: 0, deaths: 0 };
  }
}

export interface PlayerSummary {
  steamId: string;
  latestName: string | null;
  countryCode: string | null;
  visits: number;
  totalSeconds: number;
  lastSeen: Date | null;
  previousNames: string[];
  rank7d: PlayerRankInfo;
  rivals7d: PlayerRivals;
  topWeapons7d: Array<{ weapon: string; kills: number }>;
}

export async function loadPlayerSummary(steamId: string): Promise<PlayerSummary> {
  const [rank7d, rivals7d] = await Promise.all([
    loadPlayerRank(steamId, 7),
    loadTopRivals(steamId, 7),
  ]);
  if (!database || !steamId) {
    return {
      steamId,
      latestName: null,
      countryCode: null,
      visits: 0,
      totalSeconds: 0,
      lastSeen: null,
      previousNames: [],
      rank7d,
      rivals7d,
      topWeapons7d: [],
    };
  }
  try {
    const [sess] = await database<
      Array<{
        latest_name: string | null;
        country_code: string | null;
        visits: number | string;
        total_seconds: number | string | null;
        last_seen: Date | null;
        names: string[] | null;
      }>
    >`
      SELECT (array_agg(name ORDER BY connected_at DESC))[1] AS latest_name,
             (array_agg(country_code ORDER BY connected_at DESC) FILTER (WHERE country_code IS NOT NULL))[1] AS country_code,
             count(*)::int AS visits,
             coalesce(sum(duration_seconds), 0)::int AS total_seconds,
             max(connected_at) AS last_seen,
             coalesce(array_agg(DISTINCT name), '{}') AS names
        FROM player_sessions
       WHERE steam_id = ${steamId}
    `;
    const weapons = await database<Array<{ weapon: string; kills: number | string }>>`
      SELECT weapon, count(*)::int AS kills
        FROM kill_events
       WHERE killer_steam_id = ${steamId}
         AND victim_steam_id <> 'BOT'
         AND weapon <> ''
         AND created_at >= now() - make_interval(days => 7)
       GROUP BY weapon
       ORDER BY count(*) DESC
       LIMIT 5
    `;
    const latestName = sess?.latest_name ?? null;
    const previousNames = (sess?.names ?? []).filter((n) => n !== latestName).slice(0, 6);
    return {
      steamId,
      latestName,
      countryCode: sess?.country_code ?? null,
      visits: int(sess?.visits),
      totalSeconds: int(sess?.total_seconds),
      lastSeen: sess?.last_seen ?? null,
      previousNames,
      rank7d,
      rivals7d,
      topWeapons7d: weapons.map((w) => ({ weapon: w.weapon, kills: int(w.kills) })),
    };
  } catch {
    return {
      steamId,
      latestName: null,
      countryCode: null,
      visits: 0,
      totalSeconds: 0,
      lastSeen: null,
      previousNames: [],
      rank7d,
      rivals7d,
      topWeapons7d: [],
    };
  }
}
