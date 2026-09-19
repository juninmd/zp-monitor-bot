import { describe, expect, test } from "bun:test";
import { brDayStart, loadTodayPlayers } from "../src/metricsQueries";

describe("brDayStart", () => {
  test("corta o dia na meia-noite de São Paulo, não em UTC", () => {
    // 2026-09-08 02:00 UTC ainda é 07/09 às 23h no Brasil.
    const start = brDayStart(new Date("2026-09-08T02:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-07T03:00:00.000Z");
  });

  test("logo depois da virada BR o corte anda um dia", () => {
    const start = brDayStart(new Date("2026-09-08T03:30:00Z"));
    expect(start.toISOString()).toBe("2026-09-08T03:00:00.000Z");
  });

  test("o corte é sempre anterior ou igual ao instante consultado", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    expect(brDayStart(now).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("loadTodayPlayers", () => {
  test("degrada para lista vazia sem DATABASE_URL, sem lançar", async () => {
    // Ambiente de teste não sobe Postgres: database é null (ver src/database.ts).
    expect(await loadTodayPlayers()).toEqual([]);
  });
});
