import { describe, expect, test } from "bun:test";
import { syncPodKnowledge } from "../src/podKnowledge";

describe("podKnowledge", () => {
  test("reads non-empty config files from pod and stores knowledge chunks", async () => {
    const stored: Array<{ source: string; text: string }> = [];
    const res = await syncPodKnowledge({
      enabled: true,
      fetchFiles: async (groups) => [
        Buffer.from("[Classic Zombie]\nHEALTH = 1800", "utf8"),
        null,
        Buffer.from("[Unlimited Clip]\nCOST = 15", "utf8"),
        ...groups.slice(3).map(() => null),
      ],
      storeText: async (source, text) => {
        stored.push({ source, text });
        return 2;
      },
    });

    expect(res).toEqual({ filesRead: 2, chunksIndexed: 4 });
    expect(stored.map((s) => s.source)).toEqual([
      "pod:zp_zombieclasses.ini",
      "pod:zp_extraitems.ini",
    ]);
    expect(stored[0]?.text).toContain("HEALTH = 1800");
  });

  test("returns zero counts when disabled or when kubectl fails gracefully", async () => {
    const disabled = await syncPodKnowledge({
      enabled: false,
      fetchFiles: async () => [],
      storeText: async () => 1,
    });
    expect(disabled).toEqual({ filesRead: 0, chunksIndexed: 0 });

    const errored = await syncPodKnowledge({
      enabled: true,
      fetchFiles: async () => {
        throw new Error("kubectl unavailable");
      },
      storeText: async () => 1,
    });
    expect(errored).toEqual({ filesRead: 0, chunksIndexed: 0 });
  });
});
