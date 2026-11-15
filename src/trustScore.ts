/**
 * Índice de confiança silencioso por jogador: cruza sinais da Steam (VAC/game
 * bans, horas em CS, conta sem CS), histórico de nicks e picos anômalos de
 * kills por minuto. Usado para badges no dashboard e alertas de alto risco no
 * Telegram — sem gerar ruído para jogadores comuns.
 */

import { pruneExpired } from "./cachePrune";
import type { SteamSignals } from "./steamSignals";

export type TrustLevel = "trusted" | "neutral" | "watch" | "high_risk";

export interface TrustSummary {
  score: number;
  level: TrustLevel;
  reasons: string[];
}

export interface TrustInput {
  origin: string;
  signals: SteamSignals | null;
  previousNamesCount: number;
  visits: number;
  recentKillsPerMin?: number;
}

const KILL_WINDOW_MS = 60_000;
const recentKills = new Map<string, number[]>();

export function recordKillTimestamp(steamId: string, now = Date.now()): number {
  if (!steamId || steamId === "BOT") return 0;
  const list = (recentKills.get(steamId) ?? []).filter((t) => now - t <= KILL_WINDOW_MS);
  list.push(now);
  recentKills.set(steamId, list);
  if (recentKills.size > 200) {
    for (const [k, times] of recentKills) {
      const fresh = times.filter((t) => now - t <= KILL_WINDOW_MS);
      if (fresh.length === 0) recentKills.delete(k);
      else recentKills.set(k, fresh);
    }
  }
  return list.length;
}

export function getRecentKillsPerMin(steamId: string, now = Date.now()): number {
  const list = recentKills.get(steamId);
  if (!list) return 0;
  const fresh = list.filter((t) => now - t <= KILL_WINDOW_MS);
  if (fresh.length === 0) {
    recentKills.delete(steamId);
    return 0;
  }
  recentKills.set(steamId, fresh);
  return fresh.length;
}

export function evaluateTrust(input: TrustInput): TrustSummary {
  let score = 60;
  const reasons: string[] = [];

  if (input.visits >= 5) {
    score += 15;
    reasons.push(`veterano (${input.visits} visitas)`);
  } else if (input.visits === 0) {
    score -= 5;
    reasons.push("primeira visita");
  }

  if (input.previousNamesCount >= 3) {
    score -= 10;
    reasons.push(`${input.previousNamesCount} nicks anteriores`);
  }

  if (input.origin.includes("non-Steam")) {
    score -= 10;
    reasons.push("cliente non-Steam (ReUnion)");
  }

  const s = input.signals;
  if (s) {
    if (s.vacBans > 0) {
      score -= 45;
      const ago = s.daysSinceLastBan !== null ? ` (há ${s.daysSinceLastBan}d)` : "";
      reasons.push(`${s.vacBans}× VAC ban${ago}`);
    }
    if (s.gameBans > 0) {
      score -= 35;
      reasons.push(`${s.gameBans}× game ban`);
    }
    if (s.communityBanned) {
      score -= 25;
      reasons.push("banido da comunidade Steam");
    }
    const totalCsHours = s.csHours.reduce((sum, g) => sum + g.hours, 0);
    if (totalCsHours >= 100) {
      score += 20;
      reasons.push(`${totalCsHours}h de CS`);
    } else if (s.ownsNoCs) {
      score -= 15;
      reasons.push("sem CS na conta Steam");
    }
  }

  if ((input.recentKillsPerMin ?? 0) >= 8) {
    score -= 20;
    reasons.push(`pico de ${input.recentKillsPerMin} kills/min`);
  }

  const clamped = Math.max(0, Math.min(100, score));
  let level: TrustLevel = "neutral";
  if (s && (s.vacBans > 0 || s.gameBans > 0 || s.communityBanned)) {
    level = "high_risk";
  } else if (clamped >= 75) {
    level = "trusted";
  } else if (clamped < 40) {
    level = "watch";
  }

  return { score: clamped, level, reasons };
}

const alertedBans = new Map<string, { at: number }>();
const ALERT_TTL_MS = 6 * 60 * 60 * 1000;

export function shouldSendTrustAlert(steamId: string, summary: TrustSummary): boolean {
  if (summary.level !== "high_risk") return false;
  pruneExpired(alertedBans, ALERT_TTL_MS);
  if (alertedBans.has(steamId)) return false;
  alertedBans.set(steamId, { at: Date.now() });
  return true;
}
