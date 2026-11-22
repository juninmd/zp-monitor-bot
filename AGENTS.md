# AGENTS.md

Command center for a Counter-Strike 1.6 Zombie Plague server: monitors it over A2S and RCON, serves a live dashboard, answers questions with a Google ADK agent over a pgvector RAG, and operates the server from Telegram. Built for one Kubernetes-hosted server; outside that environment it runs in degraded mode.

## Stack
- Bun 1.3.13, TypeScript (ESM), Elysia (HTTP and WebSocket), gamedig (A2S), Google ADK and GenAI via LiteLLM, pgvector through `DATABASE_URL`, zod, `@napi-rs/canvas`.
- Docker image built from `Dockerfile` (`oven/bun:1.3.13`), port 8091.

## Commands
- Install: `bun install --frozen-lockfile`
- Dev: `bun run dev` (watch mode); start: `bun run start`
- Lint: `bun run lint` (Biome); typecheck: `bun run typecheck` (`tsc --noEmit`)
- Test: `bun test` (needs fake env vars, see Gotchas)
- Build: `bun run build` (outputs `dist/`)
- Smoke: `bun run smoke` (end-to-end; needs real DB, Telegram, RCON; see Gotchas)

## Structure
- `src/index.ts`: entry point; wires monitor, Telegram, dashboard and WebSocket
- `src/agent/`: ADK agent, tools, cooldowns, memory, LiteLLM adapter
- `src/` (monitor and game): `gamedig` status, `logParser.ts`, `logTail.ts`, `rcon.ts`, `goldsrcRcon.ts`, `gameMaster.ts`, `mapRotation.ts`, `trustScore.ts`
- `src/` (store and knowledge): `database.ts`, `knowledge*.ts`, `embeddings.ts`, `metrics*.ts`, `playerStore.ts`
- `src/telegram*.ts`: bot, commands, notifier
- `src/config.ts`: all env vars, validated on import
- `knowledge/`: seed docs for RAG (copied into the image)
- `public/`: dashboard (`/`); `assets/`: fonts for image rendering
- `tests/`: `bun test` suites, `tests/setup.ts` preload
- `.github/workflows/`: `ci.yml` (lint, typecheck, test, build on push to `main` and PRs), `docker.yml` (build and push on `main`), `security.yml`, `validate.yml`

## Conventions
- Lint with Biome (`biome.json`) and typecheck before a PR; CI runs both.
- Secrets come from a local `.env` or a Kubernetes Secret. Never commit tokens or keys. `.env.example` lists variable names only.
- Security posture (keep intact):
  - Telegram accepts only `TELEGRAM_CHAT_ID`; other chats are refused and audited.
  - `POST /api/telegram` requires a bearer token, compared with `crypto.timingSafeEqual`.
  - RCON parser accepts only `/rcon status|stats|users|zp_telemetry_snapshot` and `/map <name>`. No free text reaches the console.
  - Map names are reduced to `[a-zA-Z0-9_-]`, 3-32 characters, before `changelevel`.
  - Game tools act on the sender only, never on a model-chosen target; ammo is capped by `AGENT_AMMO_MAX_AMOUNT`, and each tool has a cooldown.
  - Agent replies pass `sanitizeChatReply` before `amx_csay`. RAG content enters the prompt marked as untrusted.
  - Questions, commands, RCON output and denials go to `audit_events`.
  - The knowledge write tool (`store_zombie_knowledge`) exists only on the Telegram admin agent (`answerZombieQuestion`), never in in-game chat. Each write is audited before and after and succeeds only after embed and pgvector upsert.

## Gotchas
- `src/config.ts` validates required env vars on import, so any test that imports it needs them. CI uses fake values: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LITELLM_API_KEY`, `RCON_PASSWORD`. Locally, Bun loads `.env`.
- `bun run smoke` needs a real pgvector DB, RCON and Telegram token, writes a fact, and sends a real Telegram message to `TELEGRAM_CHAT_ID`. Do not run it against production by accident.
- Without `DATABASE_URL`, audit and RAG are off; that is an operational limitation, not a supported mode.
- The dashboard (`/`), `/stats`, `/api/state`, `/api/today` and `/ws` have no auth. Treat the service as internal and do not expose port 8091 publicly.
- The Docker image copies only `src`, `public`, `assets`, `knowledge` and the manifests. Changes outside those paths do not ship in the image.
- `K8S_NAMESPACE`, `K8S_POD_SELECTOR` and `K8S_CONTAINER` default to the target server's cluster names; override them anywhere else, or log tailing and map files will not find the server.

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.
