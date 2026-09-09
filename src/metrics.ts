/**
 * Métricas do dia (fuso America/Sao_Paulo). O agregado vive em memória para o
 * caminho quente do parser de log, mas é espelhado em `kill_events` e
 * reidratado no boot: restart do pod não zera mais o dia.
 * Só contam jogadores reais: kills/chat envolvendo bots são ignorados.
 */

import { loadDailyTotals } from "./metricsQueries";
import { enqueueKill, samplePresence } from "./metricsStore";

const BR_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface PlayerKills {
  name: string;
  kills: number;
  deaths: number;
}

interface DayMetrics {
  day: string;
  kills: number;
  deaths: number;
  chatLines: number;
  players: Map<string, PlayerKills>;
  weapons: Map<string, number>;
  peakHumans: number;
  distinctHumans: Set<string>;
}

function dayKey(): string {
  return BR_DAY.format(new Date());
}

let current: DayMetrics = {
  day: dayKey(),
  kills: 0,
  deaths: 0,
  chatLines: 0,
  players: new Map(),
  weapons: new Map(),
  peakHumans: 0,
  distinctHumans: new Set(),
};

function ensureDay(): void {
  const today = dayKey();
  if (current.day !== today) {
    current = {
      day: today,
      kills: 0,
      deaths: 0,
      chatLines: 0,
      players: new Map(),
      weapons: new Map(),
      peakHumans: 0,
      distinctHumans: new Set(),
    };
  }
}

const humanKey = (name: string, steamId: string): string =>
  steamId !== "BOT" ? `${steamId}:${name}` : `bot:${name}`;

export function recordKill(k: {
  killerName: string;
  killerSteamId: string;
  victimName: string;
  victimSteamId: string;
  weapon: string;
}): void {
  ensureDay();
  const killerBot = k.killerSteamId === "BOT";
  const victimBot = k.victimSteamId === "BOT";
  // Persiste toda kill que envolva humano; o filtro bot-x-bot fica no SQL,
  // para as agregações usarem exatamente as mesmas regras daqui.
  if (!killerBot || !victimBot) enqueueKill(k);
  // Só kills entre humanos reais contam para o placar - matar bot inflaria
  // o top fragger com farm de bot.
  if (!killerBot && !victimBot) {
    current.kills += 1;
    const entry = current.players.get(humanKey(k.killerName, k.killerSteamId)) ?? {
      name: k.killerName,
      kills: 0,
      deaths: 0,
    };
    entry.name = k.killerName;
    entry.kills += 1;
    current.players.set(humanKey(k.killerName, k.killerSteamId), entry);
    if (k.weapon) {
      current.weapons.set(k.weapon, (current.weapons.get(k.weapon) ?? 0) + 1);
    }
  }
  // Morte conta sempre que a vítima é humana, mesmo morta por bot.
  if (!victimBot) {
    current.deaths += 1;
    const entry = current.players.get(humanKey(k.victimName, k.victimSteamId)) ?? {
      name: k.victimName,
      kills: 0,
      deaths: 0,
    };
    entry.name = k.victimName;
    entry.deaths += 1;
    current.players.set(humanKey(k.victimName, k.victimSteamId), entry);
  }
}

export function recordHumanChat(): void {
  ensureDay();
  current.chatLines += 1;
}

export function recordHumanSeen(steamId: string): void {
  ensureDay();
  if (steamId !== "BOT") current.distinctHumans.add(steamId);
}

export function samplePeakHumans(humans: number, zombies = 0, map = ""): void {
  ensureDay();
  if (humans > current.peakHumans) current.peakHumans = humans;
  samplePresence(map, humans, zombies);
}

/**
 * Recarrega o dia corrente do banco. Chamado no boot: sem isso um restart às
 * 22h reportaria "0 kills hoje" com o servidor cheio desde as 18h.
 */
export async function hydrateMetrics(): Promise<void> {
  const totals = await loadDailyTotals();
  if (!totals) return;
  ensureDay();
  current.kills = totals.kills;
  current.deaths = totals.deaths;
  current.peakHumans = Math.max(current.peakHumans, totals.peakHumans);
  // Semeia o Set com os steamids do dia em vez de guardar só a contagem: com a
  // contagem, quem entrasse depois do boot não somava até o Set vivo passar o
  // valor hidratado.
  for (const steamId of totals.distinctHumans) current.distinctHumans.add(steamId);
  // Mesma chave do agregado vivo: kills posteriores somam no jogador certo em
  // vez de abrirem uma segunda linha no top fragger. Sem LIMIT na consulta: o
  // 6º colocado de hoje reiniciaria do zero e nunca mais apareceria no board.
  current.players = new Map(
    totals.fraggers.map(
      (p) =>
        [humanKey(p.name, p.steamId), { name: p.name, kills: p.kills, deaths: p.deaths }] as const,
    ),
  );
  current.weapons = new Map(totals.weapons);
}

export function getMetrics() {
  ensureDay();
  const topFraggers = [...current.players.values()]
    .filter((p) => p.kills > 0)
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 5);
  const topWeapons = [...current.weapons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    day: current.day,
    kills: current.kills,
    deaths: current.deaths,
    chatLines: current.chatLines,
    peakHumans: current.peakHumans,
    distinctHumans: current.distinctHumans.size,
    topFraggers,
    topWeapons,
  };
}
