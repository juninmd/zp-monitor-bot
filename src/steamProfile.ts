import { config } from "./config";
import { pruneExpired } from "./cachePrune";

export interface SteamProfile {
  steam64: string;
  /** Nome do perfil na Steam (steamID). */
  profileName: string | null;
  realName: string | null;
  countryCode: string | null;
  avatarUrl: string | null;
  /** Avatar baixado, quando o fetch da imagem teve sucesso. */
  avatar: Buffer | null;
  /** Criação da conta; só visível via API oficial e em perfil público. */
  createdAt: Date | null;
  visibility: "public" | "private" | null;
}

// Avatar "padrão" que a Steam serve para contas sem foto - não vale a foto.
const DEFAULT_AVATAR_MARKER = "fef49e7fa7e1997311d70519ec159086263cf3a45";

const PROFILE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; profile: SteamProfile | null }>();

export function countryFlag(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65);
}

/** Extrai os campos usados do perfil XML público da Steam (endpoint ?xml=1). */
export function parseProfileXml(xml: string): {
  profileName: string | null;
  realName: string | null;
  countryCode: string | null;
  avatarUrl: string | null;
} {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const tag = (name: string): string | null => {
    const content = xml.match(
      new RegExp(`<${name}>((?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|[^<])*)</${name}>`),
    )?.[1];
    if (!content) return null;
    return (
      content
        .replace(
          /<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
          (match: string, cdata: string | undefined, entity: string) => {
            if (cdata !== undefined) return cdata;
            if (!entity.startsWith("#")) return entities[entity] ?? match;
            const code = entity.startsWith("#x")
              ? Number.parseInt(entity.slice(2), 16)
              : Number(entity.slice(1));
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
              ? String.fromCodePoint(code)
              : match;
          },
        )
        .trim() || null
    );
  };
  return {
    profileName: tag("steamID"),
    realName: tag("realName"),
    countryCode: tag("country"),
    avatarUrl: tag("avatarFull"),
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
  return response.json();
}

async function fetchAvatar(avatarUrl: string): Promise<Buffer | null> {
  if (avatarUrl.includes(DEFAULT_AVATAR_MARKER)) return null;
  try {
    const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function loadProfile(steam64: string): Promise<SteamProfile | null> {
  let profileName: string | null = null;
  let realName: string | null = null;
  let countryCode: string | null = null;
  let avatarUrl: string | null = null;
  let createdAt: Date | null = null;
  let visibility: SteamProfile["visibility"] = null;

  if (config.steamApiKey) {
    const payload = (await fetchJson(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(config.steamApiKey)}&steamids=${steam64}`,
    )) as { response?: { players?: Array<Record<string, unknown>> } };
    const player = payload.response?.players?.[0];
    if (!player) return null;
    profileName = typeof player.personaname === "string" ? player.personaname : null;
    realName = typeof player.realname === "string" ? player.realname : null;
    countryCode = typeof player.loccountrycode === "string" ? player.loccountrycode : null;
    avatarUrl = typeof player.avatarfull === "string" ? player.avatarfull : null;
    // timecreated só vem em perfil público; communityvisibilitystate: 3 = público.
    createdAt = typeof player.timecreated === "number" ? new Date(player.timecreated * 1000) : null;
    if (typeof player.communityvisibilitystate === "number") {
      visibility = player.communityvisibilitystate === 3 ? "public" : "private";
    }
  } else {
    const response = await fetch(`https://steamcommunity.com/profiles/${steam64}/?xml=1`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Steam XML HTTP ${response.status}`);
    const parsed = parseProfileXml(await response.text());
    profileName = parsed.profileName;
    realName = parsed.realName;
    countryCode = parsed.countryCode;
    avatarUrl = parsed.avatarUrl;
  }

  return {
    steam64,
    profileName,
    realName,
    countryCode,
    avatarUrl,
    avatar: avatarUrl ? await fetchAvatar(avatarUrl) : null,
    createdAt,
    visibility,
  };
}

/**
 * Perfil público (nome, nome real, país e foto) de um SteamID64. Sem chave de
 * API o perfil XML público é lido direto do site - ambos falham graciosamente
 * para quem tem perfil privado, então a notificação de entrada nunca depende
 * disso. Resultado em cache por 30min (foto por 1h).
 */
export async function getSteamProfile(steam64: string | null): Promise<SteamProfile | null> {
  if (!steam64) return null;
  const cached = cache.get(steam64);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.profile;
  try {
    const profile = await loadProfile(steam64);
    pruneExpired(cache, PROFILE_TTL_MS);
    cache.set(steam64, { at: Date.now(), profile });
    return profile;
  } catch (error) {
    console.warn(
      `[steamProfile] falha para ${steam64}: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Não envenena o cache com falha permanente: um 503 pode ser passageiro.
    return null;
  }
}

export function invalidateSteamProfile(steam64: string): void {
  cache.delete(steam64);
}
