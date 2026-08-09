import { expect, test } from "bun:test";
import { parseStatsFps } from "../src/monitorState";

test("parses GoldSrc FPS from a stats reply", () => {
  // Colunas: CPU In Out Uptime Users FPS Players - FPS é a 6ª, não a 1ª.
  expect(
    parseStatsFps(
      "CPU   In    Out   Uptime  Users   FPS    Players\n17.50  0.00  0.00      45     12  786.24        0",
    ),
  ).toBe(786.24);
  expect(parseStatsFps("CPU In Out Uptime Users FPS Players\n 4.00 0 0 10 2 100.0 3")).toBe(100);
  expect(parseStatsFps("sem linha numérica")).toBeNull();
});
