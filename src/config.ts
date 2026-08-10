const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

const positiveNumber = (name: string, fallback: string): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
};

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  namespace: process.env.K8S_NAMESPACE ?? "server-do-junin",
  podSelector: process.env.K8S_POD_SELECTOR ?? "app=cs16-server",
  container: process.env.K8S_CONTAINER ?? "cs16-server",
  logTailEnabled: (process.env.LOG_TAIL_ENABLED ?? "true") !== "false",
  telegramPollingEnabled: (process.env.TELEGRAM_POLLING_ENABLED ?? "true") !== "false",
  // Foto de perfil Steam: usa a API oficial quando a chave existe, senão lê o
  // perfil público XML. O chat de bot no Telegram é indesejado por padrão;
  // CHAT_RELAY_BOTS=true religa o repasse de falas de bots.
  steamApiKey: process.env.STEAM_API_KEY ?? "",
  chatRelayBots: (process.env.CHAT_RELAY_BOTS ?? "false") === "true",
  statsIntervalMin: positiveNumber("STATS_INTERVAL_MIN", "30"),
  port: positiveNumber("PORT", "8091"),
  serverHost: process.env.SERVER_HOST ?? "cs16-server-udp.server-do-junin.svc.cluster.local",
  serverPort: positiveNumber("SERVER_PORT", "27015"),
  pollIntervalMs: positiveNumber("POLL_INTERVAL_MS", "3000"),
  rconIntervalMs: positiveNumber("RCON_INTERVAL_MS", "5000"),
  rconTimeoutMs: positiveNumber("RCON_TIMEOUT_MS", "3000"),
  historyLength: positiveNumber("HISTORY_LENGTH", "720"),
  rconPassword: process.env.RCON_PASSWORD ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  knowledgeDir: process.env.KNOWLEDGE_DIR ?? "./knowledge",

  agentEnabled: (process.env.AGENT_ENABLED ?? "true") !== "false",
  // LLM served by our own LiteLLM proxy (OpenAI-compatible /v1/chat/completions),
  // not a personal API key. Tries models in order and sticks with the first
  // that works: NVIDIA (NIM) first, then Ollama Cloud, Gemini/Gemma only last.
  litellmApiKey: process.env.LITELLM_API_KEY ?? "",
  litellmBaseUrl: process.env.LITELLM_BASE_URL ?? "http://litellm.ai.svc.cluster.local:4000/v1",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "nomic-embed-text",
  agentModels: (
    process.env.AGENT_MODELS ?? "cloud/nemotron-super-49b,cloud/ollama-nemotron-ultra,cloud/gemma3"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Only chat lines matching this (case-insensitive) trigger the agent, so it
  // doesn't answer every line of normal player banter.
  agentTriggerRegex: new RegExp(
    process.env.AGENT_TRIGGER_REGEX ?? "^!(ia|bot|admin)\\b|\\bbot\\b",
    "i",
  ),
  agentSessionTtlMin: positiveNumber("AGENT_SESSION_TTL_MIN", "20"),
  agentAmmoCooldownMin: positiveNumber("AGENT_AMMO_COOLDOWN_MIN", "5"),
  agentAmmoMaxAmount: positiveNumber("AGENT_AMMO_MAX_AMOUNT", "30"),
  agentRespawnCooldownMin: positiveNumber("AGENT_RESPAWN_COOLDOWN_MIN", "2"),
  agentMapChangeCooldownMin: positiveNumber("AGENT_MAP_CHANGE_COOLDOWN_MIN", "10"),
};
