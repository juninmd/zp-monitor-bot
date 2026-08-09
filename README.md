# zp-monitor-bot

Command center do `server-do-junin`: monitor A2S/RCON, dashboard WebSocket, agente
Google ADK via LiteLLM, RAG com pgvector e integração Telegram com auditoria.

## Segurança

- Telegram aceita entrada apenas do `TELEGRAM_CHAT_ID`.
- RCON remoto é allowlist: `status`, `stats`, `users`,
  `zp_telemetry_snapshot` e `changelevel <map seguro>`.
- Texto de jogador/LLM nunca vira comando arbitrário.
- Perguntas, respostas, comandos, saídas e tentativas negadas são persistidos
  em `audit_events`.
- A tool `store_zombie_knowledge` só é exposta ao agente do administrador.
  Cada gravação gera auditoria e só retorna sucesso depois do embed e upsert no
  pgvector.
- Segredos ficam em `.env` local ou Kubernetes Secret; nunca na imagem/Git.

## Telegram

- Em produção, o `megabrain` é o único consumidor de `getUpdates` e encaminha
  os comandos namespaced ao endpoint interno autenticado deste serviço.
- `/status` ou `/players`: mapa, jogadores e telemetria.
- `/ask <pergunta>` ou texto livre: resposta ADK com contexto recuperado do
  pgvector.
- `/ask registre na memória que <fato>`: grava o fato via tool e o deixa
  imediatamente disponível para novas perguntas.
- `/rcon status|stats|users|zp_telemetry_snapshot`: comando remoto auditado.
- `/map <nome>`: troca de mapa auditada.
- `/audit`: últimas ações.
- No bot compartilhado, use `/zp`, `/zpstatus`, `/zprcon`, `/zpmap` e
  `/zpaudit`.

## Desenvolvimento

```powershell
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
bun run build
docker build -t zp-monitor-bot:local .
```

Copie `.env.example` para `.env`. O bootstrap espera o database `zplague` com
a extensão `vector` já habilitada. Na inicialização, cria as tabelas, ingere
`knowledge/*.md` e só então deixa `/health` pronto. O health expõe os totais
atuais de chunks e de chunks gravados por tool, além do último update.
