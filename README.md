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
- O print do mapa lê o overview (`overviews/<mapa>.txt` + o bitmap do
  `layer { IMAGE }`) do pod do servidor via `kubectl exec`; sem kubectl o
  recurso degrada para o radar gerado localmente. O nome do mapa vem do
  servidor e passa por quoting POSIX antes de entrar no `sh -c`.

## Telegram

- Em produção, o `megabrain` é o único consumidor de `getUpdates` e encaminha
  os comandos namespaced ao endpoint interno autenticado deste serviço.
- `/status` ou `/players`: mapa, jogadores e telemetria.
- `/stats` ou `/metrics`: métricas do dia (kills, mortes, pico de humanos,
  distintos, top fraggers e armas).
- `/ranking` ou `/top`: ranking de frags dos últimos 7 dias e recorde
  histórico de humanos simultâneos.
- `/radar`: posição e direção dos jogadores.
- `/mapa` ou `/print`: print do mapa atual (overview do servidor com posições
  sobrepostas quando a calibração existe; degrada para o radar).
- `/ask <pergunta>` ou texto livre: resposta ADK com contexto recuperado do
  pgvector.
- `/ask registre na memória que <fato>`: grava o fato via tool e o deixa
  imediatamente disponível para novas perguntas.
- `/rcon status|stats|users|zp_telemetry_snapshot`: comando remoto auditado.
- `/map <nome>`: troca de mapa auditada.
- `/audit`: últimas ações.
- No bot compartilhado, use `/zp`, `/zpstatus`, `/zprcon`, `/zpmap` e
  `/zpaudit`.

## Notificações

O canal recebe apenas:

- Entrada de jogador real: foto do perfil Steam (via `STEAM_API_KEY`, ou o
  perfil XML público), SteamID, origem (Steam ou id ReUnion non-Steam), nome e
  link do perfil. Com banco, inclui visitas acumuladas (ex.: "6ª visita" +
  último visto), "Primeira vez no servidor", tempo total jogado e nicks
  anteriores; sem banco, o aviso sai sem essas linhas.
- Saída de jogador real: mesmo perfil/origem/avatar da entrada, motivo e tempo
  que ficou.
- Entrada e saída trazem a quantidade de jogadores (reais + bots) e o mapa.
- Chat do jogo (e respostas da IA) só de jogadores reais por padrão
  (`CHAT_RELAY_BOTS=false` descarta falas de bots).
- Troca de mapa com o print do overview (texto se o overview não existir).

Queda/volta do servidor e ações da IA (respawn, AP, troca de mapa) vão só
para o log. Kills e pico de humanos seguem alimentando as métricas.
- Sem resumo periódico: métricas, ranking, radar e print do mapa saem sob
  demanda via `/status`, `/stats`, `/ranking`, `/radar` e `/mapa`.

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
`knowledge/*.md`, cria `kill_events`/`presence_samples`, reidrata as métricas
do dia e só então deixa `/health` pronto. O health expõe os totais
atuais de chunks e de chunks gravados por tool, além do último update.
