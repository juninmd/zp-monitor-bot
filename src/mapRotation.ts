/**
 * Decisão pura de rotação automática de mapa: servidor vazio (0 humanos) por
 * tempo demais num mapa impopular troca sozinho, reduzindo o tempo morto.
 * Nenhuma chamada de RCON/Telegram aqui - quem chama decide o que fazer com
 * o resultado (efeitos colaterais ficam em index.ts/notifier.ts).
 */

import { config } from "./config";
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
 * Escolhe o próximo mapa da lista de candidatos, pulando o mapa atual.
 * Round-robin simples (primeiro que não é o atual) em vez de aleatório: dá
 * previsibilidade pra quem olha os logs/anúncios do Telegram.
 */
function pickCandidate(currentMap: string, candidateMaps: string[]): string | null {
  return candidateMaps.find((map) => map !== currentMap) ?? null;
}

export function decideMapRotation(
  currentMap: string,
  humansOnline: number,
  minutesEmpty: number,
  minutesSinceLastRotation: number | null,
  config: MapRotationConfig,
): MapRotationDecision {
  if (!config.enabled) return NO_ROTATION;
  if (humansOnline > 0) return NO_ROTATION;
  if (minutesEmpty < config.emptyMinutes) return NO_ROTATION;
  if (config.popularMaps.includes(currentMap)) return NO_ROTATION;
  if (minutesSinceLastRotation !== null && minutesSinceLastRotation < config.cooldownMinutes) {
    return NO_ROTATION;
  }

  const targetMap = pickCandidate(currentMap, config.candidateMaps);
  if (!targetMap) return NO_ROTATION;

  return {
    rotate: true,
    targetMap,
    reason: `servidor vazio há ${Math.round(minutesEmpty)}min no mapa ${currentMap}, trocando para ${targetMap}`,
  };
}

// Estado do relógio de "vazio" e do cooldown, isolado do monitorState (que só
// guarda o snapshot do servidor) - resetado sempre que aparece um humano.
let emptySince: number | null = null;
let lastRotationAt: number | null = null;

/**
 * Chamado a cada tick (ver setInterval em index.ts) pra atualizar o relógio
 * de vazio e, quando a decisão pura mandar trocar, disparar o `amx_map` e
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

  const decision = decideMapRotation(currentMap, humans, minutesEmpty, minutesSinceLastRotation, {
    enabled: config.mapRotationEnabled,
    emptyMinutes: config.mapRotationEmptyMinutes,
    cooldownMinutes: config.mapRotationCooldownMinutes,
    popularMaps: config.mapRotationPopularMaps,
    candidateMaps: config.mapRotationCandidateMaps,
  });
  if (!decision.rotate || !decision.targetMap) return;

  lastRotationAt = Date.now();
  emptySince = null;
  try {
    await runRconCommand(`amx_map ${decision.targetMap}`);
    sendTelegram(`🔄 Rotação automática: ${decision.reason}`);
  } catch (err) {
    console.error("[mapRotation] amx_map failed", err);
  }
}
