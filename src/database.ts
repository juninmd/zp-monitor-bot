import { SQL } from "bun";
import { config } from "./config";

export const database = config.databaseUrl ? new SQL(config.databaseUrl) : null;

export interface AuditEvent {
  chatId: string;
  actor: string;
  action: "question" | "command" | "security" | "knowledge";
  request: string;
  response?: string;
  status: "started" | "success" | "denied" | "failed";
  metadata?: Record<string, unknown>;
}

export async function initializeDatabase(): Promise<void> {
  if (!database) {
    console.warn("[database] DATABASE_URL ausente; RAG e auditoria desativados");
    return;
  }
  await database`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      source text NOT NULL,
      chunk_hash text NOT NULL UNIQUE,
      content text NOT NULL,
      embedding_model text NOT NULL,
      embedding vector NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await database`
    CREATE TABLE IF NOT EXISTS audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      chat_id text NOT NULL,
      actor text NOT NULL,
      action text NOT NULL CHECK (action IN ('question', 'command', 'security', 'knowledge')),
      request text NOT NULL,
      response text,
      status text NOT NULL CHECK (status IN ('started', 'success', 'denied', 'failed')),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await database`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check`;
  await database`
    ALTER TABLE audit_events
    ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('question', 'command', 'security', 'knowledge'))
  `;
  // Uma linha por conexão de jogador real. É o que permite dizer "primeira vez
  // aqui" / "6ª visita" na notificação, e é a única fonte durável de retenção -
  // os logs do HLDS ficam num PVC de 1Gi que rotaciona.
  await database`
    CREATE TABLE IF NOT EXISTS player_sessions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      steam_id text NOT NULL,
      name text NOT NULL,
      ip text NOT NULL,
      connected_at timestamptz NOT NULL DEFAULT now(),
      disconnected_at timestamptz,
      duration_seconds integer,
      reason text
    )
  `;
  await database`CREATE INDEX IF NOT EXISTS player_sessions_steam_id_idx ON player_sessions (steam_id, connected_at DESC)`;
  await database`CREATE INDEX IF NOT EXISTS player_sessions_connected_at_idx ON player_sessions (connected_at DESC)`;
  await database`CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC)`;
  await database`CREATE INDEX IF NOT EXISTS knowledge_chunks_model_idx ON knowledge_chunks (embedding_model)`;
}

export async function auditEvent(event: AuditEvent): Promise<void> {
  if (!database) return;
  await database`
    INSERT INTO audit_events (chat_id, actor, action, request, response, status, metadata)
    VALUES (
      ${event.chatId},
      ${event.actor},
      ${event.action},
      ${event.request},
      ${event.response ?? null},
      ${event.status},
      ${JSON.stringify(event.metadata ?? {})}::jsonb
    )
  `;
}

export async function databaseHealth(): Promise<boolean> {
  if (!database) return false;
  const rows = await database<{ ok: number }[]>`SELECT 1 AS ok`;
  return rows[0]?.ok === 1;
}

export async function recentAudit(
  limit = 10,
): Promise<Array<{ action: string; request: string; status: string; created_at: Date }>> {
  if (!database) return [];
  return database.unsafe(
    `SELECT action, request, status, created_at
       FROM audit_events
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
}
