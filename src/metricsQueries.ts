/**
 * Agregações das métricas persistidas. O corte de dia é o de America/Sao_Paulo,
 * o mesmo que o agregado em memória usa, para os dois números baterem.
 */

import { database } from "./database";
import type { DailyTotals } from "./metricsStore";

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
       LIMIT 5
    `;
    const weapons = await database<Array<{ weapon: string; total: number | string }>>`
      SELECT weapon, count(*)::int AS total
        FROM kill_events
       WHERE created_at >= ${dayStart}
         AND killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
         AND weapon <> ''
       GROUP BY weapon
       ORDER BY count(*) DESC
       LIMIT 3
    `;
    const [peak] = await database<Array<{ peak: number | string | null }>>`
      SELECT max(humans) AS peak FROM presence_samples
       WHERE created_at >= ${dayStart}
    `;
    const [distinct] = await database<Array<{ total: number | string | null }>>`
      SELECT count(DISTINCT steam_id) AS total FROM player_sessions
       WHERE connected_at >= ${dayStart}
    `;
    return {
      kills: int(totals?.kills),
      deaths: int(totals?.deaths),
      peakHumans: int(peak?.peak),
      distinctHumans: int(distinct?.total),
      topFraggers: fraggers
        .filter((f) => int(f.kills) > 0)
        .map((f) => ({
          steamId: f.steam_id,
          name: f.name,
          kills: int(f.kills),
          deaths: int(f.deaths),
        })),
      topWeapons: weapons.map((w) => [w.weapon, int(w.total)] as [string, number]),
    };
  } catch (error) {
    console.error("[metricsQueries] loadDailyTotals falhou", error);
    return null;
  }
}

export interface RankingEntry {
  name: string;
  kills: number;
}

/** Ranking de frags dos últimos `days` dias, agrupado por conta. */
export async function loadRanking(days: number, limit = 10): Promise<RankingEntry[]> {
  if (!database) return [];
  try {
    const rows = await database<Array<{ name: string; kills: number | string }>>`
      SELECT (array_agg(killer_name ORDER BY created_at DESC))[1] AS name,
             count(*)::int AS kills
        FROM kill_events
       WHERE created_at >= now() - make_interval(days => ${days})
         AND killer_steam_id <> 'BOT' AND victim_steam_id <> 'BOT'
       GROUP BY killer_steam_id
       ORDER BY count(*) DESC
       LIMIT ${limit}
    `;
    return rows.map((r) => ({ name: r.name, kills: int(r.kills) }));
  } catch (error) {
    console.error("[metricsQueries] loadRanking falhou", error);
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
