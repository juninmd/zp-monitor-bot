/**
 * Leitura de arquivos do pod do servidor CS via `kubectl exec`. Cada print do
 * mapa precisava de dois `get pods` + dois `exec`; aqui o pod fica em cache
 * curto e todos os arquivos saem num único exec, em blocos base64.
 */

import { config } from "./config";
import { selectLogPod } from "./logTail";

interface KubectlProc {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: () => void;
}

/** Captura a saída de um comando kubectl. Rejeita em exit != 0 ou timeout. */
export function kubectlCapture(args: string[], timeoutMs = 6000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let proc: KubectlProc;
    try {
      proc = Bun.spawn(["kubectl", ...args], {
        stdout: "pipe",
        stderr: "ignore",
      }) as unknown as KubectlProc;
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("kubectl timeout"));
    }, timeoutMs);
    (async () => {
      for await (const chunk of proc.stdout) chunks.push(chunk);
      const code = await proc.exited;
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`kubectl exit ${code}`));
    })().catch((error) => {
      clearTimeout(timer);
      proc.kill();
      reject(error);
    });
  });
}

const POD_TTL_MS = 60_000;
let podCache: { at: number; pod: string | null } = { at: 0, pod: null };

async function selectPod(): Promise<string | null> {
  if (!Bun.which("kubectl")) return null;
  if (podCache.pod && Date.now() - podCache.at < POD_TTL_MS) return podCache.pod;
  try {
    const raw = await kubectlCapture([
      "get",
      "pods",
      "-n",
      config.namespace,
      "-l",
      config.podSelector,
      "-o",
      "json",
    ]);
    const pods = JSON.parse(raw.toString()) as {
      items: Array<{
        metadata: { name: string; creationTimestamp?: string; deletionTimestamp?: string };
        status?: { phase?: string };
      }>;
    };
    const pod = selectLogPod(pods.items) ?? null;
    podCache = { at: Date.now(), pod };
    return pod;
  } catch {
    return null;
  }
}

// Aspas simples POSIX: fecha, escapa a aspa, reabre. O nome do mapa vem do
// servidor, então este é o único ponto onde texto externo vira comando.
export const shellQuote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

const MARKER = (index: number): string => `@@zpfile${index}@@`;

/**
 * Lê vários arquivos num único exec. Cada entrada é uma lista de caminhos
 * candidatos e devolve o primeiro que existir, ou null. Falha inteira (sem
 * kubectl, sem pod, exec com erro) devolve null para todos.
 */
export async function fetchPodFiles(groups: string[][]): Promise<Array<Buffer | null>> {
  const empty = groups.map(() => null);
  if (groups.length === 0) return [];
  const pod = await selectPod();
  if (!pod) return empty;

  const script = groups
    .map((paths, index) => {
      const attempts = paths.map((p) => `base64 -w0 ${shellQuote(p)} 2>/dev/null`).join(" || ");
      return `printf '\\n${MARKER(index)}\\n'; ${attempts || "true"}`;
    })
    .join("; ");

  try {
    const out = await kubectlCapture([
      "exec",
      "-n",
      config.namespace,
      pod,
      "-c",
      config.container,
      "--",
      "sh",
      "-c",
      script,
    ]);
    return splitMarkedOutput(out.toString("utf8"), groups.length);
  } catch {
    // Pod pode ter sido reciclado entre o get e o exec: força novo lookup.
    podCache = { at: 0, pod: null };
    return empty;
  }
}

/** Divide a saída marcada do exec nos buffers de cada grupo. */
export function splitMarkedOutput(text: string, count: number): Array<Buffer | null> {
  const result: Array<Buffer | null> = [];
  for (let index = 0; index < count; index++) {
    const start = text.indexOf(MARKER(index));
    if (start === -1) {
      result.push(null);
      continue;
    }
    const from = start + MARKER(index).length;
    const nextIndex = index + 1 < count ? text.indexOf(MARKER(index + 1), from) : -1;
    const b64 = text.slice(from, nextIndex === -1 ? undefined : nextIndex).trim();
    result.push(b64 ? Buffer.from(b64, "base64") : null);
  }
  return result;
}
