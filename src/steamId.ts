const STEAM_RE = /^STEAM_(\d):([01]):(\d+)$/;
const STEAM64_BASE = 76561197960265728n;

export interface SteamIdInfo {
  raw: string;
  /** SteamID64, só quando o authid parece uma conta Steam real. */
  steam64: string | null;
  profileUrl: string | null;
  /** Rótulo pt-BR pronto para exibir. */
  origin: string;
}

/**
 * O ReUnion emite authid em vários universos: contas Steam de verdade chegam
 * como STEAM_0/STEAM_1, e os ids sintéticos que ele gera para clientes
 * non-Steam (cid_NoSteam47/48 = 5, derivados de IP) aparecem nos logs deste
 * servidor como STEAM_2/STEAM_3. Só o primeiro grupo tem perfil na Steam, então
 * só ele ganha link - montar a URL para um id sintético daria um perfil de
 * outra pessoa qualquer.
 */
export function describeSteamId(raw: string): SteamIdInfo {
  const m = raw.match(STEAM_RE);
  if (!m) {
    return { raw, steam64: null, profileUrl: null, origin: "authid não reconhecido" };
  }
  const universe = Number(m[1]);
  const authServer = BigInt(m[2] ?? "0");
  const accountId = BigInt(m[3] ?? "0");
  if (universe > 1) {
    return { raw, steam64: null, profileUrl: null, origin: "non-Steam (id gerado pelo ReUnion)" };
  }
  const steam64 = (STEAM64_BASE + accountId * 2n + authServer).toString();
  return {
    raw,
    steam64,
    profileUrl: `https://steamcommunity.com/profiles/${steam64}`,
    origin: "Steam",
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}min`;
  if (m) return `${m}min ${s}s`;
  return `${s}s`;
}
