import { expect, test } from "bun:test";
import { renderHistoryChart } from "../src/chart";

const series = (n: number) => ({
  t: Array.from({ length: n }, (_, i) => Date.now() + i * 1000),
  players: Array.from({ length: n }, (_, i) => i % 3),
  zombies: Array.from({ length: n }, () => 4),
  humans: Array.from({ length: n }, () => 2),
});

test("gráfico precisa de ao menos 2 pontos", () => {
  expect(renderHistoryChart(series(1), "x")).toBeNull();
});

test("gera um PNG válido", () => {
  const png = renderHistoryChart(series(10), "x");
  expect(png?.subarray(0, 4).toString("hex")).toBe("89504e47");
});
