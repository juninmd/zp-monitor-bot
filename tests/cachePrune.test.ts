import { describe, expect, test } from "bun:test";
import { pruneExpired } from "../src/cachePrune";

describe("pruneExpired", () => {
  test("drops only expired entries", () => {
    const cache = new Map([
      ["old", { at: Date.now() - 10_000 }],
      ["fresh", { at: Date.now() }],
    ]);
    pruneExpired(cache, 5_000);
    expect([...cache.keys()]).toEqual(["fresh"]);
  });
});
