// src/config.ts valida as env vars obrigatórias no import. Workflows que rodam
// `bun test` sem env (ex.: o reusable-validate do base-actions) derrubavam toda
// suite que puxa config transitivamente. Valores fake: nenhum teste faz rede.
process.env.TELEGRAM_BOT_TOKEN ??= "test-fake-token";
process.env.TELEGRAM_CHAT_ID ??= "0";
