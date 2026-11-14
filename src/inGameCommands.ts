/**
 * Comandos rápidos in-game (`!stats`, `!rank`, `!rival`, `!rtv`, `!comandos`):
 * respondem direto via RCON `amx_csay` sem gastar tokens de LLM, e gerenciam
 * votação proporcional de troca de mapa (Rock The Vote) entre humanos reais.
 */

import { sanitizeChatReply } from "./agent/agent";
import { remainingMin, tryConsume } from "./agent/cooldowns";
import { config } from "./config";
import { auditEvent } from "./database";
import { getMetrics } from "./metrics";
import { loadPlayerRank, loadTopRivals } from "./metricsQueries";
import { getPlayerCounts } from "./monitorState";
import { runRconCommand } from "./rcon";
import { sendTelegram } from "./telegram";

export interface InGameCmdPlayer {
  name: string;
  steamId: string;
}

export interface InGameCommandDeps {
  say: (text: string) => Promise<void>;
  runRcon: typeof runRconCommand;
  notifyTelegram: (text: string) => void;
  audit: typeof auditEvent;
  getHumansCount: () => number;
  getRank: typeof loadPlayerRank;
  getRivals: typeof loadTopRivals;
  getDailyMetrics: typeof getMetrics;
  consume: typeof tryConsume;
  cooldownRemaining: typeof remainingMin;
  rtvEnabled: boolean;
  rtvCooldownMin: number;
}

const defaultDeps: InGameCommandDeps = {
  say: async (text: string) => {
    const clean = sanitizeChatReply(text);
    if (!clean) return;
    await runRconCommand(`amx_csay [ZP] ${clean}`);
  },
  runRcon: runRconCommand,
  notifyTelegram: sendTelegram,
  audit: auditEvent,
  getHumansCount: () => getPlayerCounts()?.humans ?? 1,
  getRank: loadPlayerRank,
  getRivals: loadTopRivals,
  getDailyMetrics: getMetrics,
  consume: tryConsume,
  cooldownRemaining: remainingMin,
  get rtvEnabled() {
    return config.rtvEnabled;
  },
  get rtvCooldownMin() {
    return config.rtvCooldownMin;
  },
};

const rtvVotes = new Map<string, string>();

export function resetRtvVotes(): void {
  rtvVotes.clear();
}

export function getRtvStatus(): { map: string; votes: number }[] {
  const counts = new Map<string, number>();
  for (const map of rtvVotes.values()) {
    counts.set(map, (counts.get(map) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([map, votes]) => ({ map, votes }))
    .sort((a, b) => b.votes - a.votes);
}

/**
 * Tenta processar um comando rápido determinístico de chat.
 * Retorna `true` se a mensagem foi tratada (para não acionar a IA à toa).
 */
export async function handleInGameCommand(
  player: InGameCmdPlayer,
  message: string,
  deps: InGameCommandDeps = defaultDeps,
): Promise<boolean> {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const safeName = sanitizeChatReply(player.name) || "Jogador";

  if (lower === "!comandos" || lower === "!help") {
    await deps.say("Comandos: !stats !rank !rival !rtv <mapa> ou pergunte algo com !ia");
    return true;
  }

  if (lower === "!stats" || lower === "!rank") {
    const rank = await deps.getRank(player.steamId, 7);
    if (rank.kills === 0 && rank.deaths === 0) {
      const today = deps.getDailyMetrics();
      await deps.say(
        `${safeName}: sem frags nos ultimos 7d. Hoje o server soma ${today.kills} kills (${today.peakHumans} pico).`,
      );
      return true;
    }
    const kd = (rank.kills / Math.max(1, rank.deaths)).toFixed(2);
    const pos = rank.rank ? `#${rank.rank}/${rank.totalRanked}` : "fora do top";
    await deps.say(
      `${safeName} (7d): ${pos} · ${rank.kills} kills · ${rank.deaths} mortes · K/D ${kd}`,
    );
    return true;
  }

  if (lower === "!rival" || lower === "!rivais") {
    const rivals = await deps.getRivals(player.steamId, 7);
    if (!rivals.fregues && !rivals.algoz) {
      await deps.say(`${safeName}: ainda sem rivalidades suficientes nos ultimos 7 dias.`);
      return true;
    }
    const parts: string[] = [];
    if (rivals.fregues) {
      parts.push(`Fregues: ${rivals.fregues.name} (${rivals.fregues.kills}x)`);
    }
    if (rivals.algoz) {
      parts.push(`Algoz: ${rivals.algoz.name} (${rivals.algoz.deaths}x)`);
    }
    await deps.say(`${safeName} (7d) -> ${parts.join(" | ")}`);
    return true;
  }

  const rtvMatch = trimmed.match(/^!(?:rtv|votemap)(?:\s+([a-z0-9_-]{3,32}))?$/i);
  if (rtvMatch) {
    if (!deps.rtvEnabled) {
      await deps.say("Votacao RTV desativada no momento.");
      return true;
    }
    const targetMap = rtvMatch[1]?.toLowerCase();
    if (!targetMap) {
      const status = getRtvStatus();
      const summary = status.length
        ? status.map((s) => `${s.map} (${s.votes})`).join(", ")
        : "nenhum voto ainda";
      await deps.say(`Use !rtv <mapa>. Votos atuais: ${summary}`);
      return true;
    }

    const humans = Math.max(1, deps.getHumansCount());
    const needed = Math.max(1, Math.ceil(humans / 2));
    rtvVotes.set(player.steamId, targetMap);

    let votesForMap = 0;
    for (const m of rtvVotes.values()) {
      if (m === targetMap) votesForMap++;
    }

    if (votesForMap < needed) {
      await deps.say(
        `${safeName} votou em ${targetMap} (${votesForMap}/${needed} votos para trocar).`,
      );
      return true;
    }

    if (!deps.consume("rtv:map-change", deps.rtvCooldownMin)) {
      const wait = deps.cooldownRemaining("rtv:map-change", deps.rtvCooldownMin);
      await deps.say(`Aprovado para ${targetMap}, mas em cooldown (aguarde ${wait} min).`);
      return true;
    }

    resetRtvVotes();
    await deps.audit({
      chatId: "ingame:rtv",
      actor: `${player.name} (${player.steamId})`,
      action: "command",
      request: `changelevel ${targetMap}`,
      status: "started",
      metadata: { votes: votesForMap, needed, humans },
    });
    try {
      const out = await deps.runRcon(`changelevel ${targetMap}`);
      await deps.audit({
        chatId: "ingame:rtv",
        actor: `${player.name} (${player.steamId})`,
        action: "command",
        request: `changelevel ${targetMap}`,
        response: out.trim().slice(0, 300),
        status: "success",
      });
      await deps.say(`RTV aprovado (${votesForMap}/${needed})! Trocando para ${targetMap}...`);
      deps.notifyTelegram(
        `🗳️ RTV aprovado no jogo (${votesForMap}/${needed} votos): trocando para <b>${targetMap}</b>.`,
      );
    } catch (error) {
      await deps.audit({
        chatId: "ingame:rtv",
        actor: `${player.name} (${player.steamId})`,
        action: "command",
        request: `changelevel ${targetMap}`,
        response: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
      await deps.say(`Falha ao trocar para ${targetMap}.`);
    }
    return true;
  }

  return false;
}
