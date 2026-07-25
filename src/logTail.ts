import { config } from "./config";
import { type LogEvent, parseLine } from "./logParser";

const RECONNECT_DELAY_MS = 5000;

async function consumeStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: LogEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseLine(line);
      if (event) onEvent(event);
    }
  }
}

async function runKubectlOnce(onEvent: (event: LogEvent) => void): Promise<void> {
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
      "--tail=0",
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
  const logResponse = await fetch(
    `${base}/api/v1/namespaces/${encodeURIComponent(config.namespace)}/pods/${encodeURIComponent(podName)}/log?container=${encodeURIComponent(config.container)}&follow=true&tailLines=0`,
    { headers, tls },
  );
  if (!logResponse.ok || !logResponse.body) {
    throw new Error(`Kubernetes logs HTTP ${logResponse.status}`);
  }
  console.log(`[logTail] Kubernetes API logs -f started (${podName})`);
  await consumeStream(logResponse.body, onEvent);
}

export async function startLogTail(onEvent: (e: LogEvent) => void): Promise<void> {
  while (true) {
    try {
      if (process.env.KUBERNETES_SERVICE_HOST) {
        await runKubernetesApiOnce(onEvent);
      } else {
        await runKubectlOnce(onEvent);
      }
    } catch (err) {
      console.error("[logTail] error", err);
    }
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
  }
}
