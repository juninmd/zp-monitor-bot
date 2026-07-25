import { answerZombieQuestion } from "./agent/agent";
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
  const question = "O que é o modo Nemesis e como os humanos devem reagir?";
  const context = await retrieveKnowledge(question);
  if (context.length === 0) throw new Error("pgvector não retornou contexto");
  const answer = await answerZombieQuestion("smoke", question, context);
  if (!answer) throw new Error("ADK/LiteLLM não retornou resposta");
  await auditEvent({
    chatId: "smoke",
    actor: "smoke-test",
    action: "question",
    request: question,
    response: answer,
    status: "success",
    metadata: { contextChunks: context.length },
  });
  const rcon = await runRconCommand("status");
  if (!rcon.trim() || /bad rcon_password|invalid password/i.test(rcon)) {
    throw new Error("RCON status sem autenticação válida");
  }
  await auditEvent({
    chatId: "smoke",
    actor: "smoke-test",
    action: "command",
    request: "status",
    response: rcon.slice(0, 1000),
    status: "success",
  });
  await proveTelegramDelivery(
    `✅ ZP smoke: pgvector=${context.length} chunks, ADK=${answer.length} chars, RCON=${rcon.length} chars`,
  );
  console.log(
    `SMOKE_OK database=true pgvector_chunks=${context.length} ingested=${ingested} adk_answer_chars=${answer.length} rcon_chars=${rcon.length} telegram=true`,
  );
}

main().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exit(1);
});
