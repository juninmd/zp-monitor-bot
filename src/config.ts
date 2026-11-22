const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

export const positiveNumber = (name: string, fallback: string): number => {
  const raw = process.env[name]?.trim();
  const value = Number(raw || fallback);
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
  // not a personal API key. cloud/auto: provider choice and fallbacks live in LiteLLM.
  litellmApiKey: process.env.LITELLM_API_KEY ?? "",
  litellmBaseUrl: process.env.LITELLM_BASE_URL ?? "http://litellm.ai.svc.cluster.local:4000/v1",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "nomic-embed-text",
  agentModels: (process.env.AGENT_MODELS ?? "cloud/auto")
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

  // Rotação automática de mapa: servidor vazio (0 humanos) por tempo demais
  // num mapa fora da lista de populares troca sozinho, pra não ficar rodando
  // um mapa ruim pra ninguém.
  mapRotationEnabled: (process.env.MAP_ROTATION_ENABLED ?? "true") !== "false",
  mapRotationEmptyMinutes: positiveNumber("MAP_ROTATION_EMPTY_MINUTES", "15"),
  mapRotationCooldownMinutes: positiveNumber("MAP_ROTATION_COOLDOWN_MINUTES", "60"),
  mapRotationPopularMaps: (process.env.MAP_ROTATION_POPULAR_MAPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  mapRotationCandidateMaps: (process.env.MAP_ROTATION_CANDIDATE_MAPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  retentionDays: positiveNumber("RETENTION_DAYS", "90"),
  gameMasterEnabled: (process.env.GAME_MASTER_ENABLED ?? "true") !== "false",
  gameMasterCooldownMin: positiveNumber("GAME_MASTER_COOLDOWN_MIN", "3"),
  rtvEnabled: (process.env.RTV_ENABLED ?? "true") !== "false",
  rtvCooldownMin: positiveNumber("RTV_COOLDOWN_MIN", "10"),
  trustAlertEnabled: (process.env.TRUST_ALERT_ENABLED ?? "true") !== "false",
  podKnowledgeEnabled: (process.env.POD_KNOWLEDGE_ENABLED ?? "true") !== "false",
};
