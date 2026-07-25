import type { Context } from "@google/adk";
import { answerZombieQuestion } from "./agent/agent";
import { buildKnowledgeTools } from "./agent/knowledgeTools";
import { buildToolsForPlayer } from "./agent/tools";
import { config } from "./config";
import { auditEvent, databaseHealth, initializeDatabase } from "./database";
import { ingestKnowledgeDirectory, retrieveKnowledge } from "./knowledgeStore";
import { runRconCommand } from "./rcon";

async function proveTelegramDelivery(message: string): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.telegramChatId, text: message }),
    },
  );
  if (!response.ok) throw new Error(`Telegram delivery falhou: HTTP ${response.status}`);
}

async function main(): Promise<void> {
  await initializeDatabase();
  if (!(await databaseHealth())) throw new Error("database health falhou");
  const ingested = await ingestKnowledgeDirectory();
  const fact =
    "No server-do-junin, os comandos remotos permitidos pelo Telegram incluem status, stats, users e zp_telemetry_snapshot.";
  const [knowledgeTool] = buildKnowledgeTools({
    chatId: "smoke",
    actor: "cluster-smoke",
  });
  if (!knowledgeTool) throw new Error("store_zombie_knowledge não registrado");
  await knowledgeTool.runAsync({
    args: { fact, source: "homologacao_tools" },
    toolContext: undefined as unknown as Context,
  });
  const question = "Quais comandos remotos o Telegram permite no server-do-junin?";
  const context = await retrieveKnowledge(question);
  if (!context.some((chunk) => chunk.includes("zp_telemetry_snapshot"))) {
    throw new Error("pgvector não recuperou o fato salvo pela tool");
  }
  const answer = await answerZombieQuestion("smoke", question, context, "cluster-smoke");
  if (!answer) throw new Error("ADK/LiteLLM não retornou resposta");
  if (!answer.includes("status") || !answer.includes("zp_telemetry_snapshot")) {
    throw new Error("resposta ADK não usou o conteúdo recuperado do pgvector");
  }
  await auditEvent({
    chatId: "smoke",
    actor: "smoke-test",
    action: "question",
    request: question,
    response: answer,
    status: "success",
    metadata: { contextChunks: context.length },
  });
  const rconReplies = new Map<string, string>();
  for (const command of ["status", "stats", "users", "zp_telemetry_snapshot"]) {
    const reply = await runRconCommand(command);
    if (!reply.trim() || /bad rcon_password|invalid password/i.test(reply)) {
      throw new Error(`RCON ${command} sem autenticação válida`);
    }
    rconReplies.set(command, reply);
  }
  const rcon = rconReplies.get("status") ?? "";
  await auditEvent({
    chatId: "smoke",
    actor: "smoke-test",
    action: "command",
    request: "status",
    response: rcon.slice(0, 1000),
    status: "success",
  });
  const dryRunCommands: string[] = [];
  const playerTools = buildToolsForPlayer(
    { name: 'Smoke";quit', uid: "999", steamId: "STEAM_CLUSTER_SMOKE" },
    {
      runRcon: async (command) => {
        dryRunCommands.push(command);
        return "dry-run";
      },
      notify: () => {},
      consume: () => true,
      cooldownRemaining: () => 0,
    },
  );
  const playerToolArguments: Record<string, Record<string, unknown>> = {
    respawn_player: {},
    give_ammo_packs: { amount: 17 },
    unstick_player: {},
    change_map: { mapName: "zm_dust2" },
  };
  for (const tool of playerTools) {
    await tool.runAsync({
      args: playerToolArguments[tool.name] ?? {},
      toolContext: undefined as unknown as Context,
    });
  }
  if (dryRunCommands.length !== 4) throw new Error("matriz de tools de jogador incompleta");
  await proveTelegramDelivery(
    `✅ ZP smoke: tool→pgvector→ADK OK, tools=${playerTools.length + 1}, RCON=${rconReplies.size}`,
  );
  console.log(
    `SMOKE_OK database=true knowledge_tool=true pgvector_chunks=${context.length} ingested=${ingested} adk_grounded=true adk_answer_chars=${answer.length} player_tools=${playerTools.length} rcon_commands=${rconReplies.size} telegram=true`,
  );
}

main().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exit(1);
});
