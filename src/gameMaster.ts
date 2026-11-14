/**
 * AI Game Master: acompanha kill streaks e eventos especiais do Zombie Plague
 * para soltar narrações curtas no HUD do servidor (`amx_csay`) com cooldown
 * global rigoroso, dando vida à partida sem virar spam.
 */

import { sanitizeChatReply } from "./agent/agent";
import { tryConsume } from "./agent/cooldowns";
import { config } from "./config";
import { runRconCommand } from "./rcon";

const streaks = new Map<string, number>();

export interface GameMasterDependencies {
  enabled: boolean;
  cooldownMin: number;
  consume: typeof tryConsume;
  say: (text: string) => Promise<void>;
}

const defaultDeps: GameMasterDependencies = {
  get enabled() {
    return config.gameMasterEnabled;
  },
  get cooldownMin() {
    return config.gameMasterCooldownMin;
  },
  consume: tryConsume,
  say: async (text: string) => {
    const clean = sanitizeChatReply(text);
    if (!clean) return;
    await runRconCommand(`amx_csay [GM] ${clean}`);
  },
};

const MILESTONE_LINES: Record<number, (name: string, weapon: string) => string> = {
  5: (name, weapon) => `${name} esta imparavel: 5 kills seguidos (${weapon})!`,
  10: (name) => `${name} atingiu 10 kills sem morrer! Alguem para esse monstro!`,
  15: (name) => `LENDARIO! ${name} fez 15 kills seguidos!`,
};

export async function handleGameMasterKill(
  killer: { steamId: string; name: string },
  victim: { steamId: string; name: string },
  weapon: string,
  deps: GameMasterDependencies = defaultDeps,
): Promise<string | null> {
  if (victim.steamId !== "BOT") {
    streaks.delete(victim.steamId);
  }
  if (!deps.enabled || killer.steamId === "BOT" || victim.steamId === "BOT") return null;

  const count = (streaks.get(killer.steamId) ?? 0) + 1;
  streaks.set(killer.steamId, count);

  const formatter = MILESTONE_LINES[count];
  if (!formatter) return null;
  if (!deps.consume("gm:global", deps.cooldownMin)) return null;

  const line = formatter(
    sanitizeChatReply(killer.name) || "Jogador",
    sanitizeChatReply(weapon) || "arma",
  );
  await deps.say(line).catch((err) => console.warn("[gameMaster] say failed", err));
  return line;
}

export function resetPlayerStreak(steamId: string): void {
  streaks.delete(steamId);
}

const MODE_CALLOUTS: Record<string, string> = {
  nemesis: "MODO NEMESIS! Fuja ou foque fogo no boss!",
  survivor: "MODO SURVIVOR! Protejam o sobrevivente!",
  plague: "MODO PLAGUE! Nemesis e Survivors em guerra total!",
  swarm: "MODO SWARM! Sem infeccao — sobrevivam ate o fim!",
};

let lastAnnouncedMode = "";

export async function handleGameMasterMode(
  mode: string,
  deps: GameMasterDependencies = defaultDeps,
): Promise<string | null> {
  const key = mode.trim().toLowerCase();
  if (!deps.enabled || !key || key === lastAnnouncedMode) return null;
  lastAnnouncedMode = key;

  const callout = Object.entries(MODE_CALLOUTS).find(([k]) => key.includes(k))?.[1];
  if (!callout) return null;
  if (!deps.consume("gm:global", deps.cooldownMin)) return null;

  await deps.say(callout).catch((err) => console.warn("[gameMaster] mode say failed", err));
  return callout;
}
