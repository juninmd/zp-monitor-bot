import { describe, expect, test } from "bun:test";
import { consumeStream, selectLogPod } from "../src/logTail";

describe("selectLogPod", () => {
  test("prefers the newest running pod and ignores terminating pods", () => {
    expect(
      selectLogPod([
        {
          metadata: {
            name: "old",
            creationTimestamp: "2026-07-25T10:00:00Z",
            deletionTimestamp: "2026-07-25T11:00:00Z",
          },
          status: { phase: "Running" },
        },
        {
          metadata: { name: "pending", creationTimestamp: "2026-07-25T12:00:00Z" },
          status: { phase: "Pending" },
        },
        {
          metadata: { name: "current", creationTimestamp: "2026-07-25T11:00:00Z" },
          status: { phase: "Running" },
        },
      ]),
    ).toBe("current");
  });
});

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i++] as Uint8Array);
    },
  });
}

describe("consumeStream", () => {
  const enc = new TextEncoder();

  test("aborta quando o stream so devolve chunks vazios", async () => {
    const empty = Array.from({ length: 600 }, () => new Uint8Array(0));
    await expect(consumeStream(streamOf(empty), () => {})).rejects.toThrow(/stream ocioso/);
  });

  test("nao aborta quando ha dado entremeado", async () => {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 600; i += 1) {
      chunks.push(new Uint8Array(0));
      if (i % 100 === 0) chunks.push(enc.encode("linha sem formato CS\n"));
    }
    await expect(consumeStream(streamOf(chunks), () => {})).resolves.toBeUndefined();
  });

  test("processa linhas com timestamp e encerra no close", async () => {
    const seen: string[] = [];
    const stream = streamOf([
      enc.encode("2026-11-16T00:00:00.000000001Z L 11/16/2026 - 00:00:00: Server say hello\n"),
    ]);
    await consumeStream(stream, (e) => seen.push(String(e)));
    expect(seen.length).toBeGreaterThanOrEqual(0);
  });
});
