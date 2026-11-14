/**
 * Decisão pura de rotação automática de mapa: servidor vazio (0 humanos) por
 * tempo demais num mapa impopular troca sozinho, reduzindo o tempo morto.
 * Nenhuma chamada de RCON/Telegram aqui - quem chama decide o que fazer com
 * o resultado (efeitos colaterais ficam em index.ts/notifier.ts).
 */

import { config } from "./config";
import { database } from "./database";
import { monitorState } from "./monitorState";
import { runRconCommand } from "./rcon";
import { sendTelegram } from "./telegram";

export interface MapRotationConfig {
  enabled: boolean;
  emptyMinutes: number;
  cooldownMinutes: number;
  popularMaps: string[];
  candidateMaps: string[];
}

export interface MapRotationDecision {
  rotate: boolean;
  targetMap: string | null;
  reason: string;
}

const NO_ROTATION: MapRotationDecision = { rotate: false, targetMap: null, reason: "" };

/**
 * Escolhe o próximo mapa da lista de candidatos:
 * - Se houver scores de retenção (média de humanos no banco), prioriza o mapa
 *   candidato com melhor desempenho fora o atual;
 * - Caso contrário, avança circularmente após o mapa atual para nunca oscilar
 *   eternamente apenas entre os dois primeiros candidatos.
 */
function pickCandidate(
  currentMap: string,
  candidateMaps: string[],
  retentionScores?: Record<string, number>,
): string | null {
  const valid = candidateMaps.filter((map) => map && map !== currentMap);
  if (valid.length === 0) return null;

  if (retentionScores && Object.keys(retentionScores).length > 0) {
    const scored = [...valid].sort((a, b) => (retentionScores[b] ?? 0) - (retentionScores[a] ?? 0));
    const best = scored[0];
    if (best && (retentionScores[best] ?? 0) > 0) return best;
  }

  const idx = candidateMaps.indexOf(currentMap);
  if (idx >= 0) {
    for (let offset = 1; offset < candidateMaps.length; offset++) {
      const candidate = candidateMaps[(idx + offset) % candidateMaps.length];
      if (candidate && candidate !== currentMap) return candidate;
    }
  }
  return valid[0] ?? null;
}

export function decideMapRotation(
  currentMap: string,
  humansOnline: number,
  minutesEmpty: number,
  minutesSinceLastRotation: number | null,
  config: MapRotationConfig,
  retentionScores?: Record<string, number>,
): MapRotationDecision {
  if (!config.enabled) return NO_ROTATION;
  if (humansOnline > 0) return NO_ROTATION;
  if (minutesEmpty < config.emptyMinutes) return NO_ROTATION;
  if (config.popularMaps.includes(currentMap)) return NO_ROTATION;
  if (minutesSinceLastRotation !== null && minutesSinceLastRotation < config.cooldownMinutes) {
    return NO_ROTATION;
  }

  const targetMap = pickCandidate(currentMap, config.candidateMaps, retentionScores);
  if (!targetMap) return NO_ROTATION;

  return {
    rotate: true,
    targetMap,
    reason: `servidor vazio há ${Math.round(minutesEmpty)}min no mapa ${currentMap}, trocando para ${targetMap}`,
  };
}

async function loadMapRetentionScores(days = 14): Promise<Record<string, number>> {
  if (!database) return {};
  try {
    const rows = await database<Array<{ map: string; avg_humans: number | string }>>`
      SELECT map, avg(humans)::float AS avg_humans
        FROM presence_samples
       WHERE created_at >= now() - make_interval(days => ${days})
         AND map <> ''
       GROUP BY map
       HAVING count(*) >= 5
    `;
    const scores: Record<string, number> = {};
    for (const row of rows) {
      scores[row.map] = Number(row.avg_humans ?? 0);
    }
    return scores;
  } catch {
    return {};
  }
}

// Estado do relógio de "vazio" e do cooldown, isolado do monitorState (que só
// guarda o snapshot do servidor) - resetado sempre que aparece um humano.
let emptySince: number | null = null;
let lastRotationAt: number | null = null;

/**
 * Chamado a cada tick (ver setInterval em index.ts) pra atualizar o relógio
 * de vazio e, quando a decisão pura mandar trocar, disparar o `changelevel` e
 * avisar no Telegram o porquê.
 */
export async function checkMapRotation(): Promise<void> {
  const humans = monitorState.players.length;
  const currentMap = monitorState.info?.map ?? "";
  if (!monitorState.connection.online || !currentMap) return;

  if (humans > 0) {
    emptySince = null;
    return;
  }
  if (emptySince === null) emptySince = Date.now();

  const minutesEmpty = (Date.now() - emptySince) / 60_000;
  const minutesSinceLastRotation =
    lastRotationAt === null ? null : (Date.now() - lastRotationAt) / 60_000;

  const scores = await loadMapRetentionScores();
  const decision = decideMapRotation(
    currentMap,
    humans,
    minutesEmpty,
    minutesSinceLastRotation,
    {
      enabled: config.mapRotationEnabled,
      emptyMinutes: config.mapRotationEmptyMinutes,
      cooldownMinutes: config.mapRotationCooldownMinutes,
      popularMaps: config.mapRotationPopularMaps,
      candidateMaps: config.mapRotationCandidateMaps,
    },
    scores,
  );
  if (!decision.rotate || !decision.targetMap) return;

  lastRotationAt = Date.now();
  emptySince = null;
  try {
    await runRconCommand(`changelevel ${decision.targetMap}`);
    sendTelegram(`🔄 Rotação automática: ${decision.reason}`);
  } catch (err) {
    console.error("[mapRotation] changelevel failed", err);
  }
}
