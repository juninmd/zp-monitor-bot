const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  namespace: process.env.K8S_NAMESPACE ?? "server-do-junin",
  podSelector: process.env.K8S_POD_SELECTOR ?? "app=cs16-server",
  container: process.env.K8S_CONTAINER ?? "cs16-server",
  statsIntervalMin: Number(process.env.STATS_INTERVAL_MIN ?? "30"),
  port: Number(process.env.PORT ?? "8091"),
  rconScriptPath:
    process.env.RCON_SCRIPT_PATH ??
    "../.claude/skills/cs16-server-admin/scripts/rcon.ps1",

  agentEnabled: (process.env.AGENT_ENABLED ?? "true") !== "false",
  // LLM served by our own LiteLLM proxy (OpenAI-compatible /v1/chat/completions),
  // not a personal API key. Tries models in order and sticks with the first
  // that works: NVIDIA (NIM) first, then Ollama Cloud, Gemini/Gemma only last.
  litellmApiKey: process.env.LITELLM_API_KEY ?? "",
  litellmBaseUrl: process.env.LITELLM_BASE_URL ?? "https://litellm.antonio-code.duckdns.org/v1",
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
  agentSessionTtlMin: Number(process.env.AGENT_SESSION_TTL_MIN ?? "20"),
  agentAmmoCooldownMin: Number(process.env.AGENT_AMMO_COOLDOWN_MIN ?? "5"),
  agentAmmoMaxAmount: Number(process.env.AGENT_AMMO_MAX_AMOUNT ?? "30"),
  agentRespawnCooldownMin: Number(process.env.AGENT_RESPAWN_COOLDOWN_MIN ?? "2"),
  agentMapChangeCooldownMin: Number(process.env.AGENT_MAP_CHANGE_COOLDOWN_MIN ?? "10"),
};
