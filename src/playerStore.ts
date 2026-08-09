import { database } from "./database";

export interface PlayerHistory {
  /** true quando este steamid nunca apareceu antes. */
  firstTime: boolean;
  visits: number;
  lastSeen: Date | null;
  totalSeconds: number;
  /** Nicks anteriores diferentes do atual, mais recentes primeiro. */
  previousNames: string[];
}

export const UNKNOWN_HISTORY: PlayerHistory = {
  firstTime: false,
  visits: 0,
  lastSeen: null,
  totalSeconds: 0,
  previousNames: [],
};

interface HistoryRow {
  visits: string | number;
  last_seen: Date | null;
  total_seconds: string | number | null;
  previous_names: string[] | null;
}

/**
 * Registra a conexão e devolve o histórico do jogador ANTES dela, para a
 * notificação poder dizer "primeira vez aqui" ou "6ª visita, esteve aqui há
 * 3 dias". Devolve o histórico vazio (e não lança) quando não há banco: a
 * notificação é mais importante que a estatística.
 */
export async function recordConnect(player: {
  steamId: string;
  name: string;
  ip: string;
}): Promise<PlayerHistory> {
  if (!database) return UNKNOWN_HISTORY;
  try {
    const rows = await database<HistoryRow[]>`
      SELECT count(*)::int AS visits,
             max(connected_at) AS last_seen,
             coalesce(sum(duration_seconds), 0)::int AS total_seconds,
             coalesce(
               array_agg(DISTINCT name) FILTER (WHERE name <> ${player.name}),
               '{}'
             ) AS previous_names
        FROM player_sessions
       WHERE steam_id = ${player.steamId}
    `;
    await database`
      INSERT INTO player_sessions (steam_id, name, ip)
      VALUES (${player.steamId}, ${player.name}, ${player.ip})
    `;
    const row = rows[0];
    const visits = Number(row?.visits ?? 0);
    return {
      firstTime: visits === 0,
      visits,
      lastSeen: row?.last_seen ?? null,
      totalSeconds: Number(row?.total_seconds ?? 0),
      previousNames: (row?.previous_names ?? []).slice(0, 5),
    };
  } catch (error) {
    console.error("[playerStore] recordConnect falhou", error);
    return UNKNOWN_HISTORY;
  }
}

/** Fecha a sessão aberta mais recente do jogador. Silencioso em erro. */
export async function recordDisconnect(
  steamId: string,
  seconds: number | null,
  reason: string,
): Promise<void> {
  if (!database) return;
  try {
    await database`
      UPDATE player_sessions
         SET disconnected_at = now(),
             duration_seconds = ${seconds},
             reason = ${reason || null}
       WHERE id = (
         SELECT id FROM player_sessions
          WHERE steam_id = ${steamId} AND disconnected_at IS NULL
          ORDER BY connected_at DESC
          LIMIT 1
       )
    `;
  } catch (error) {
    console.error("[playerStore] recordDisconnect falhou", error);
  }
}
