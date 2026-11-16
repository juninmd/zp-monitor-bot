import { config } from "./config";
import { type LogEvent, parseLine } from "./logParser";

const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60_000;
// Um reconnect que morre em menos que isso e sinal de problema (pod ausente,
// erro de API, stream travado) e nao de stream saudavel que caiu de verdade.
const HEALTHY_STREAM_MS = 30_000;
// Guarda contra o stream que "resolve" leituras vazias em loop: o corpo HTTP
// do `logs?follow=true` as vezes para de entregar bytes sem sinalizar done, o
// loop nunca bloqueia e a CPU fica cravada em ~1 core sem escrever log nenhum.
// Medido em producao: pod com 0,98 core constante por horas e zero linhas.
const EMPTY_READ_LIMIT = 500;
const TIMESTAMP_LINE_RE = /^(\S+) (.*)$/;

// Marca d'água do timestamp (RFC3339Nano, do próprio `--timestamps`) da
// última linha processada. Sem isso, cada reconexão pedia só linhas novas a
// partir do momento do reconnect (--tail=0/tailLines=0) - qualquer "connected
// stream" que caísse (deploy do próprio bot, hiccup de rede, rotação do log)
// perdia pra sempre os eventos de disconnect ocorridos durante o gap, e a
// sessão em `player_sessions` nunca fechava.
let lastEventAt: string | null = null;

function stripTimestamp(raw: string): { at: string | null; line: string } {
  const m = raw.match(TIMESTAMP_LINE_RE);
  if (!m) return { at: null, line: raw };
  return { at: m[1] ?? null, line: m[2] ?? "" };
}

export async function consumeStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: LogEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emptyReads = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) {
      // Chunk vazio nao e progresso: conta e aborta depois do limite para o
      // loop externo reconectar em vez de girar a CPU.
      emptyReads += 1;
      if (emptyReads >= EMPTY_READ_LIMIT) {
        throw new Error(`stream ocioso: ${emptyReads} leituras vazias seguidas`);
      }
      continue;
    }
    emptyReads = 0;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const { at, line } = stripTimestamp(raw);
      // --since-time é inclusivo: a linha de corte pode vir de novo na
      // reconexão. Timestamp tem precisão de nanossegundo, então "<=" evita
      // reprocessar sem risco real de descartar um evento distinto.
      if (at) {
        if (lastEventAt && at <= lastEventAt) continue;
        lastEventAt = at;
      }
      const event = parseLine(line);
      if (event) onEvent(event);
    }
  }
}

async function runKubectlOnce(onEvent: (event: LogEvent) => void): Promise<void> {
  const since = lastEventAt ? ["--since-time", lastEventAt] : ["--tail=0"];
  const proc = Bun.spawn(
    [
      "kubectl",
      "logs",
      "-n",
      config.namespace,
      "-l",
      config.podSelector,
      "-c",
      config.container,
      "-f",
      "--timestamps",
      ...since,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  console.log("[logTail] kubectl logs -f started");

  try {
    await consumeStream(proc.stdout, onEvent);
  } finally {
    proc.kill();
  }

  const code = await proc.exited;
  console.warn(
    `[logTail] kubectl logs exited (code ${code}), reconnecting in ${RECONNECT_DELAY_MS}ms`,
  );
}

interface PodList {
  items: Array<{
    metadata: { name: string; creationTimestamp?: string; deletionTimestamp?: string };
    status?: { phase?: string };
  }>;
}

export function selectLogPod(pods: PodList["items"]): string | undefined {
  return pods
    .filter((pod) => !pod.metadata.deletionTimestamp && pod.status?.phase === "Running")
    .sort((a, b) =>
      (b.metadata.creationTimestamp ?? "").localeCompare(a.metadata.creationTimestamp ?? ""),
    )[0]?.metadata.name;
}

async function runKubernetesApiOnce(onEvent: (event: LogEvent) => void): Promise<void> {
  const apiHost = process.env.KUBERNETES_SERVICE_HOST;
  const apiPort = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443";
  if (!apiHost) throw new Error("KUBERNETES_SERVICE_HOST ausente");
  const token = await Bun.file("/var/run/secrets/kubernetes.io/serviceaccount/token").text();
  const ca = await Bun.file("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt").text();
  const base = `https://${apiHost}:${apiPort}`;
  const headers = { authorization: `Bearer ${token}` };
  const tls = { ca };
  const listResponse = await fetch(
    `${base}/api/v1/namespaces/${encodeURIComponent(config.namespace)}/pods?labelSelector=${encodeURIComponent(config.podSelector)}`,
    { headers, tls },
  );
  if (!listResponse.ok) throw new Error(`Kubernetes pods HTTP ${listResponse.status}`);
  const pods = (await listResponse.json()) as PodList;
  const podName = selectLogPod(pods.items);
  if (!podName) throw new Error(`nenhum pod encontrado para ${config.podSelector}`);
  const since = lastEventAt ? `&sinceTime=${encodeURIComponent(lastEventAt)}` : "&tailLines=0";
  const logResponse = await fetch(
    `${base}/api/v1/namespaces/${encodeURIComponent(config.namespace)}/pods/${encodeURIComponent(podName)}/log?container=${encodeURIComponent(config.container)}&follow=true&timestamps=true${since}`,
    { headers, tls },
  );
  if (!logResponse.ok || !logResponse.body) {
    throw new Error(`Kubernetes logs HTTP ${logResponse.status}`);
  }
  console.log(`[logTail] Kubernetes API logs -f started (${podName})`);
  await consumeStream(logResponse.body, onEvent);
}

export async function startLogTail(onEvent: (e: LogEvent) => void): Promise<void> {
  let delay = RECONNECT_DELAY_MS;
  while (true) {
    const startedAt = Date.now();
    try {
      if (process.env.KUBERNETES_SERVICE_HOST) {
        await runKubernetesApiOnce(onEvent);
      } else {
        await runKubectlOnce(onEvent);
      }
    } catch (err) {
      console.error("[logTail] error", err);
    }
    // Stream saudavel que cai volta rapido; reconexao que morre em segundos
    // (pod ausente, erro de API, stream travado) sobe o delay ate 60s.
    const lasted = Date.now() - startedAt;
    delay =
      lasted >= HEALTHY_STREAM_MS
        ? RECONNECT_DELAY_MS
        : Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    await new Promise((r) => setTimeout(r, delay));
  }
}
