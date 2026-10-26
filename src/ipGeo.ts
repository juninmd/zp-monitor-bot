import { pruneExpired } from "./cachePrune";

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; countryCode: string | null }>();

const PRIVATE_PREFIXES = ["10.", "127.", "192.168.", "0."];

function isPrivate(host: string): boolean {
  if (PRIVATE_PREFIXES.some((p) => host.startsWith(p))) return true;
  const octets = host.split(".").map(Number);
  return octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31;
}

/**
 * País por IP via ip-api.com (grátis, sem chave, só HTTP no plano free).
 * Cobre também os IDs sintéticos non-Steam do ReUnion (STEAM_2/3), que não
 * têm perfil Steam de onde tirar o país. Resultado em cache 24h por IP.
 */
export async function getCountryByIp(ip: string): Promise<string | null> {
  const host = ip.split(":")[0] ?? "";
  if (!host || isPrivate(host)) return null;

  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.countryCode;

  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(host)}?fields=status,countryCode`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!response.ok) throw new Error(`ip-api HTTP ${response.status}`);
    const data = (await response.json()) as { status?: string; countryCode?: string };
    const countryCode = data.status === "success" && data.countryCode ? data.countryCode : null;
    pruneExpired(cache, TTL_MS);
    cache.set(host, { at: Date.now(), countryCode });
    return countryCode;
  } catch (error) {
    console.warn(
      `[ipGeo] falha para ${host}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
