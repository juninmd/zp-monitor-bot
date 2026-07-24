import { InMemorySessionService } from "@google/adk";
import { config } from "../config";

const APP_NAME = "zp-admin-bot";

export const sessionService = new InMemorySessionService();

const lastActivity = new Map<string, number>();

/**
 * Short-term memory: one ADK session per player (keyed by steamId), reset
 * whenever it's been idle past AGENT_SESSION_TTL_MIN so old context doesn't
 * bleed into an unrelated conversation hours later.
 */
export async function getOrCreatePlayerSession(steamId: string) {
  const now = Date.now();
  const ttlMs = config.agentSessionTtlMin * 60 * 1000;
  const last = lastActivity.get(steamId);
  if (last !== undefined && now - last > ttlMs) {
    await sessionService.deleteSession({
      appName: APP_NAME,
      userId: steamId,
      sessionId: steamId,
    });
  }
  lastActivity.set(steamId, now);

  return sessionService.getOrCreateSession({
    appName: APP_NAME,
    userId: steamId,
    sessionId: steamId,
  });
}

export { APP_NAME };
