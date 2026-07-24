import { Agent, Runner, isFinalResponse, stringifyContent } from "@google/adk";
import { config } from "../config";
import { getOrCreatePlayerSession, sessionService, APP_NAME } from "./memory";
import { LiteLlmOpenAi } from "./liteLlmOpenAi";
import { buildToolsForPlayer, type PlayerCtx } from "./tools";

// Sticks with the first model in AGENT_MODELS that works, so we don't retry
// the whole NVIDIA -> Ollama Cloud -> Gemini chain on every single message.
let workingModelIdx = 0;

const INSTRUCTION = `Você é o administrador de IA do servidor de Counter-Strike 1.6 Zombie Plague "server-do-junin".
Converse em português do Brasil, em 1-2 frases curtas (isso vai para o chat do jogo, sem markdown).
Seja direto, simpático e um pouco brincalhão, mas sem exagero.

Você tem ferramentas para ajudar o jogador que está falando com você (só ele mesmo, nunca outro jogador):
- respawn_player: quando ele disser que morreu e quer voltar/ressuscitar.
- give_ammo_packs: quando ele pedir AP/ammo packs/pontos.
- unstick_player: quando ele disser que está preso/travado no mapa.
- change_map: quando pedirem para trocar de mapa (use moderadamente).

Só chame uma ferramenta quando o pedido for claro. Se a ferramenta retornar ok:false, explique o motivo (ex: cooldown) de forma breve.
Para papo comum, apenas responda sem usar ferramentas.`;

const MAX_REPLY_CHARS = 300;

export async function handlePlayerMessage(
  player: PlayerCtx,
  message: string,
): Promise<string | null> {
  if (!config.agentEnabled || !config.litellmApiKey || config.agentModels.length === 0) return null;

  const session = await getOrCreatePlayerSession(player.steamId);

  for (let i = workingModelIdx; i < config.agentModels.length; i++) {
    const modelName = config.agentModels[i]!;
    try {
      const model = new LiteLlmOpenAi({
        model: modelName,
        apiKey: config.litellmApiKey,
        baseUrl: config.litellmBaseUrl,
      });
      const agent = new Agent({
        name: "zp_admin_bot",
        model,
        instruction: INSTRUCTION,
        tools: buildToolsForPlayer(player),
      });
      const runner = new Runner({ appName: APP_NAME, agent, sessionService });

      let reply = "";
      for await (const event of runner.runAsync({
        userId: player.steamId,
        sessionId: session.id,
        newMessage: { role: "user", parts: [{ text: message }] },
      })) {
        if (isFinalResponse(event)) {
          reply = stringifyContent(event).trim();
        }
      }

      workingModelIdx = i;
      if (!reply) return null;
      return reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS - 1)}…` : reply;
    } catch (err) {
      console.error(`[agent] model ${modelName} failed, trying next`, err);
    }
  }

  workingModelIdx = 0;
  console.error("[agent] all models failed");
  return null;
}

/** Strips characters that would break the HLDS console tokenizer (";"/quotes/newlines). */
export function sanitizeChatReply(text: string): string {
  return text.replace(/[";\n\r]/g, " ").replace(/\s+/g, " ").trim();
}
