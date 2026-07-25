import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { type AuditEvent, auditEvent } from "../database";
import { storeKnowledgeText } from "../knowledgeStore";

interface KnowledgeToolActor {
  chatId: string;
  actor: string;
}

interface KnowledgeToolDependencies {
  store: (source: string, content: string) => Promise<number>;
  audit: (event: AuditEvent) => Promise<void>;
}

const productionDependencies: KnowledgeToolDependencies = {
  store: storeKnowledgeText,
  audit: auditEvent,
};

export function buildKnowledgeTools(
  identity: KnowledgeToolActor,
  dependencies: KnowledgeToolDependencies = productionDependencies,
): FunctionTool[] {
  return [
    new FunctionTool({
      name: "store_zombie_knowledge",
      description:
        "Salva permanentemente um fato novo sobre este servidor ou Zombie Plague e indexa o conteúdo imediatamente no pgvector. Use somente quando o administrador pedir explicitamente para salvar, registrar ou lembrar uma informação.",
      parameters: z.object({
        fact: z.string().min(10).max(4000).describe("Informação factual a armazenar"),
        source: z
          .string()
          .min(2)
          .max(48)
          .regex(/^[a-zA-Z0-9_-]+$/)
          .default("telegram")
          .describe("Categoria curta da origem, sem espaços"),
      }),
      execute: async ({ fact, source }) => {
        await dependencies.audit({
          chatId: identity.chatId,
          actor: identity.actor,
          action: "knowledge",
          request: fact,
          status: "started",
          metadata: { tool: "store_zombie_knowledge", source },
        });
        try {
          const indexedChunks = await dependencies.store(
            `tool:${source.toLowerCase()}`,
            fact.trim(),
          );
          const result = {
            ok: true,
            indexedChunks,
            source: `tool:${source.toLowerCase()}`,
          };
          await dependencies.audit({
            chatId: identity.chatId,
            actor: identity.actor,
            action: "knowledge",
            request: fact,
            response: JSON.stringify(result),
            status: "success",
            metadata: { tool: "store_zombie_knowledge", source },
          });
          return result;
        } catch (error) {
          await dependencies.audit({
            chatId: identity.chatId,
            actor: identity.actor,
            action: "knowledge",
            request: fact,
            response: error instanceof Error ? error.message : String(error),
            status: "failed",
            metadata: { tool: "store_zombie_knowledge", source },
          });
          throw error;
        }
      },
    }),
  ];
}
