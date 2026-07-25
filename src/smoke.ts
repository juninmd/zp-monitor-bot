import { answerZombieQuestion } from "./agent/agent";
import { auditEvent, databaseHealth, initializeDatabase } from "./database";
import { ingestKnowledgeDirectory, retrieveKnowledge } from "./knowledgeStore";
import { runRconCommand } from "./rcon";

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
  if (!rcon.trim()) throw new Error("RCON status sem resposta");
  await auditEvent({
    chatId: "smoke",
    actor: "smoke-test",
    action: "command",
    request: "status",
    response: rcon.slice(0, 1000),
    status: "success",
  });
  console.log(
    `SMOKE_OK database=true pgvector_chunks=${context.length} ingested=${ingested} adk_answer_chars=${answer.length} rcon_chars=${rcon.length}`,
  );
}

main().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exit(1);
});
