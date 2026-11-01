/**
 * Kills recentes por mapa, em memória. Alimenta o heatmap de combate (/calor)
 * e o resumo do mapa que acabou. O banco guarda o agregado do dia, mas não a
 * posição nem a divisão por mapa, e estes dados só valem enquanto o mapa dura.
 */

export interface MapKill {
  map: string;
  killerName: string;
  killerSteamId: string;
  victimSteamId: string;
  weapon: string;
  x: number;
  y: number;
}

// Teto defensivo: bots matando bots geram milhares de linhas por mapa.
const CAP = 3000;
let kills: MapKill[] = [];

export function recordMapKill(kill: MapKill): void {
  kills.push(kill);
  if (kills.length > CAP) kills = kills.slice(-CAP);
}

/** Pontos de morte do mapa, prontos para sobrepor no print. */
export function deathSpots(map: string): Array<{ x: number; y: number }> {
  return kills.filter((k) => k.map === map).map((k) => ({ x: k.x, y: k.y }));
}

export interface MapSummary {
  map: string;
  kills: number;
  /** Kills de jogadores reais (matar bot não entra no MVP). */
  topFraggers: Array<{ name: string; kills: number }>;
  topWeapon: { weapon: string; kills: number } | null;
}

/** Resume o mapa e, com `drop`, descarta os dados dele (mapa encerrado). */
export function summarizeMap(map: string, drop = false): MapSummary | null {
  const own = kills.filter((k) => k.map === map);
  if (drop) kills = kills.filter((k) => k.map !== map);
  if (!own.length) return null;

  const frags = new Map<string, number>();
  const weapons = new Map<string, number>();
  for (const k of own) {
    if (k.killerSteamId === "BOT") continue;
    frags.set(k.killerName, (frags.get(k.killerName) ?? 0) + 1);
    if (k.weapon) weapons.set(k.weapon, (weapons.get(k.weapon) ?? 0) + 1);
  }
  const topFraggers = [...frags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, kills: count }));
  const weapon = [...weapons.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    map,
    kills: own.length,
    topFraggers,
    topWeapon: weapon ? { weapon: weapon[0], kills: weapon[1] } : null,
  };
}

export function clearMapKills(): void {
  kills = [];
}
