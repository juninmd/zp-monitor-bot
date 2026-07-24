import { config } from "./config";
import { parseLine, type LogEvent } from "./logParser";

const RECONNECT_DELAY_MS = 5000;

async function runOnce(onEvent: (e: LogEvent) => void): Promise<void> {
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

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = parseLine(line);
        if (ev) onEvent(ev);
      }
    }
  } finally {
    proc.kill();
  }

  const code = await proc.exited;
  console.warn(`[logTail] kubectl logs exited (code ${code}), reconnecting in ${RECONNECT_DELAY_MS}ms`);
}

export async function startLogTail(onEvent: (e: LogEvent) => void): Promise<void> {
  while (true) {
    try {
      await runOnce(onEvent);
    } catch (err) {
      console.error("[logTail] error", err);
    }
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
  }
}
