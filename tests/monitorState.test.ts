import { expect, test } from "bun:test";
import { parseStatsFps } from "../src/monitorState";

test("parses GoldSrc FPS from a stats reply", () => {
  expect(parseStatsFps("CPU In Out Uptime Users FPS Players\n 4.00 0 0 10 2 100.0 3")).toBe(4);
  expect(parseStatsFps("sem linha numérica")).toBeNull();
});
