import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { config } from "../config";
import { runRconCommand } from "../rcon";
import { sendTelegram, escapeHtml } from "../telegram";
import { tryConsume, remainingMin } from "./cooldowns";

// The HLDS console splits on ";" and does not strip a second layer of
// quotes - never interpolate raw player/LLM text into an RCON command
// without passing it through this first.
function sanitizeToken(s: string, maxLen: number): string {
  return s.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, maxLen);
}

export interface PlayerCtx {
  name: string;
  uid: string;
  steamId: string;
}

/** Builds the allowlisted admin tools, bound to the player who is chatting. */
export function buildToolsForPlayer(player: PlayerCtx): FunctionTool[] {
  // amx_* commands take the in-game name; a quoted exact-name target is safer
  // than uid against a stale/duplicated slot, and avoids letting the LLM name
  // an arbitrary other player (only this sender's own name is ever used).
  const safeName = player.name.replace(/["\n;]/g, "").slice(0, 32);

  const respawnPlayer = new FunctionTool({
    name: "respawn_player",
    description:
      "Ressuscita/respawna o jogador que está pedindo ajuda no chat (ele mesmo), caso esteja morto/travado esperando o round. Só funciona se ele estiver morto e num time válido.",
    execute: async () => {
      const key = `respawn:${player.steamId}`;
      if (!tryConsume(key, config.agentRespawnCooldownMin)) {
        return { ok: false, reason: `cooldown, tente de novo em ${remainingMin(key, config.agentRespawnCooldownMin)} min` };
      }
      const out = await runRconCommand(`zp_respawn "${safeName}"`);
      sendTelegram(`🤖 IA respawnou <b>${escapeHtml(player.name)}</b> a pedido dele no chat.`);
      return { ok: true, rconOutput: out.trim().slice(0, 200) };
    },
  });

  const giveAmmoPacks = new FunctionTool({
    name: "give_ammo_packs",
    description:
      "Dá Ammo Packs (AP, a moeda do Zombie Plague) para o jogador que está pedindo no chat (ele mesmo). Use uma quantidade modesta.",
    parameters: z.object({
      amount: z
        .number()
        .int()
        .min(1)
        .max(config.agentAmmoMaxAmount)
        .describe(`Quantidade de AP a dar, entre 1 e ${config.agentAmmoMaxAmount}`),
    }),
    execute: async ({ amount }) => {
      const key = `ammo:${player.steamId}`;
      if (!tryConsume(key, config.agentAmmoCooldownMin)) {
        return { ok: false, reason: `cooldown, tente de novo em ${remainingMin(key, config.agentAmmoCooldownMin)} min` };
      }
      const clamped = Math.min(Math.max(1, Math.round(amount)), config.agentAmmoMaxAmount);
      const out = await runRconCommand(`zp_give_ammo "${safeName}" ${clamped}`);
      sendTelegram(`🤖 IA deu <b>${clamped} AP</b> para <b>${escapeHtml(player.name)}</b> a pedido dele no chat.`);
      return { ok: true, amount: clamped, rconOutput: out.trim().slice(0, 200) };
    },
  });

  const unstickPlayer = new FunctionTool({
    name: "unstick_player",
    description:
      "Dá um leve empurrão (sem dano) no jogador que está pedindo ajuda no chat (ele mesmo), útil quando ele está preso/travado na geometria do mapa.",
    execute: async () => {
      const key = `unstick:${player.steamId}`;
      if (!tryConsume(key, config.agentRespawnCooldownMin)) {
        return { ok: false, reason: `cooldown, tente de novo em ${remainingMin(key, config.agentRespawnCooldownMin)} min` };
      }
      const out = await runRconCommand(`amx_slap "${safeName}" 0`);
      sendTelegram(`🤖 IA deu um "slap" (destravar) em <b>${escapeHtml(player.name)}</b> a pedido dele no chat.`);
      return { ok: true, rconOutput: out.trim().slice(0, 200) };
    },
  });

  const changeMap = new FunctionTool({
    name: "change_map",
    description:
      "Troca o mapa do servidor quando os jogadores pedirem. Use com moderação - só quando explicitamente pedido, não por qualquer comentário.",
    parameters: z.object({
      mapName: z.string().min(3).max(32).describe("Nome exato do mapa (ex: zm_dust2)"),
    }),
    execute: async ({ mapName }) => {
      const key = "map-change";
      if (!tryConsume(key, config.agentMapChangeCooldownMin)) {
        return { ok: false, reason: `cooldown global, tente de novo em ${remainingMin(key, config.agentMapChangeCooldownMin)} min` };
      }
      const safeMap = sanitizeToken(mapName, 32);
      if (safeMap.length < 3) {
        return { ok: false, reason: "nome de mapa inválido" };
      }
      const out = await runRconCommand(`changelevel ${safeMap}`);
      sendTelegram(`🤖 IA trocou o mapa para <b>${escapeHtml(safeMap)}</b> a pedido de <b>${escapeHtml(player.name)}</b> no chat.`);
      return { ok: true, mapName: safeMap, rconOutput: out.trim().slice(0, 200) };
    },
  });

  return [respawnPlayer, giveAmmoPacks, unstickPlayer, changeMap];
}
