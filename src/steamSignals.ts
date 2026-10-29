/**
 * Sinais de reputação da conta Steam: bans (VAC/jogo/comunidade) e horas em
 * Counter-Strike. Numa CS 1.6 pública são os dois dados que dizem se o cara
 * é veterano ou conta descartável recém-criada.
 *
 * Depende de STEAM_API_KEY: o perfil XML público não expõe nada disso. Sem
 * chave, ou com perfil privado, tudo degrada para null e a notificação segue.
 */

import { pruneExpired } from "./cachePrune";
import { config } from "./config";

/** appids de Counter-Strike que contam como "horas de CS". */
const CS_APP_IDS: Record<number, string> = {
  10: "CS 1.6",
  80: "CS: Condition Zero",
  240: "CS: Source",
  730: "CS2",
};

export interface SteamSignals {
  vacBans: number;
  gameBans: number;
  communityBanned: boolean;
  /** Dias desde o ban mais recente; null quando nunca houve ban. */
  daysSinceLastBan: number | null;
  /** Horas por jogo de CS que a conta tem registro de ter jogado. */
  csHours: Array<{ game: string; hours: number }>;
  /** true quando a lista de jogos é visível e não contém nenhum CS. */
  ownsNoCs: boolean;
}

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; signals: SteamSignals | null }>();

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
  return response.json();
}

interface BanRow {
  VACBanned?: boolean;
  NumberOfVACBans?: number;
  NumberOfGameBans?: number;
  CommunityBanned?: boolean;
  DaysSinceLastBan?: number;
}

async function loadBans(steam64: string): Promise<BanRow | null> {
  const payload = (await fetchJson(
    `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${encodeURIComponent(config.steamApiKey)}&steamids=${steam64}`,
  )) as { players?: BanRow[] };
  return payload.players?.[0] ?? null;
}

/**
 * Lista de jogos sem `appids_filter`: a sintaxe do filtro não é documentada
 * pela Valve, então filtramos aqui em vez de chutar o formato da query.
 */
async function loadCsHours(
  steam64: string,
): Promise<{ hours: SteamSignals["csHours"]; visible: boolean }> {
  const payload = (await fetchJson(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(config.steamApiKey)}&steamid=${steam64}&include_played_free_games=1`,
  )) as { response?: { games?: Array<{ appid?: number; playtime_forever?: number }> } };
  const games = payload.response?.games;
  if (!games) return { hours: [], visible: false };
  const hours = games
    .filter((g) => typeof g.appid === "number" && g.appid in CS_APP_IDS)
    .map((g) => ({
      game: CS_APP_IDS[g.appid as number] as string,
      hours: Math.round((g.playtime_forever ?? 0) / 60),
    }))
    .filter((g) => g.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  return { hours, visible: true };
}

export async function getSteamSignals(steam64: string | null): Promise<SteamSignals | null> {
  if (!steam64 || !config.steamApiKey) return null;
  const cached = cache.get(steam64);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.signals;

  try {
    // Os dois endpoints são independentes: um perfil com jogos privados ainda
    // deve render o histórico de bans, que é sempre público.
    const [bans, games] = await Promise.all([
      loadBans(steam64).catch(() => null),
      loadCsHours(steam64).catch(() => ({ hours: [], visible: false })),
    ]);
    if (!bans && !games.visible) {
      pruneExpired(cache, TTL_MS);
      cache.set(steam64, { at: Date.now(), signals: null });
      return null;
    }
    const vacBans = bans?.NumberOfVACBans ?? (bans?.VACBanned ? 1 : 0);
    const gameBans = bans?.NumberOfGameBans ?? 0;
    const signals: SteamSignals = {
      vacBans,
      gameBans,
      communityBanned: Boolean(bans?.CommunityBanned),
      // DaysSinceLastBan vem 0 para quem nunca foi banido: sem ban, sem data.
      daysSinceLastBan:
        vacBans + gameBans > 0 && typeof bans?.DaysSinceLastBan === "number"
          ? bans.DaysSinceLastBan
          : null,
      csHours: games.hours,
      ownsNoCs: games.visible && games.hours.length === 0,
    };
    pruneExpired(cache, TTL_MS);
    cache.set(steam64, { at: Date.now(), signals });
    return signals;
  } catch (error) {
    console.warn(
      `[steamSignals] falha para ${steam64}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Linhas prontas para a notificação; vazio quando não há nada a dizer. */
export function describeSignals(signals: SteamSignals | null): string[] {
  if (!signals) return [];
  const lines: string[] = [];
  const bans: string[] = [];
  if (signals.vacBans > 0) bans.push(`${signals.vacBans}× VAC`);
  if (signals.gameBans > 0) bans.push(`${signals.gameBans}× game ban`);
  if (signals.communityBanned) bans.push("banido da comunidade");
  if (bans.length) {
    const since =
      signals.daysSinceLastBan === null ? "" : ` · último há ${signals.daysSinceLastBan}d`;
    lines.push(`⛔ <b>${bans.join(" · ")}</b>${since}`);
  }
  if (signals.csHours.length) {
    lines.push(
      `🎯 ${signals.csHours.map((g) => `${g.game}: ${g.hours.toLocaleString("pt-BR")}h`).join(" · ")}`,
    );
  } else if (signals.ownsNoCs) {
    lines.push("👻 Nenhum CS na conta (provável non-steam)");
  }
  return lines;
}
