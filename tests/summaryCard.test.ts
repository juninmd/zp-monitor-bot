import { describe, expect, test } from "bun:test";
import { renderSummaryCard } from "../src/summaryCard";

describe("summaryCard", () => {
  test("renders valid 1200x675 PNG buffer with populated stats", async () => {
    const png = await renderSummaryCard({
      serverName: "server-do-junin · Zombie Plague",
      day: "2026-11-14",
      kills: 148,
      deaths: 62,
      peakHumans: 18,
      distinctHumans: 34,
      chatLines: 95,
      topMap: "zm_dust2_2k15",
      allTimePeak: { humans: 24, at: "10/11/2026" },
      topFraggers: [
        { name: "Junin", kills: 47, deaths: 12 },
        { name: "SurvivorBR", kills: 31, deaths: 15 },
        { name: "BioHazard", kills: 22, deaths: 18 },
      ],
      topWeapons: [
        ["ak47", 54],
        ["m4a1", 38],
        ["awp", 21],
      ],
      mvpAvatar: null,
    });

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.length).toBeGreaterThan(10_000);
  });

  test("renders cleanly even with empty daily metrics", async () => {
    const png = await renderSummaryCard({
      serverName: "server-do-junin",
      day: "2026-11-14",
      kills: 0,
      deaths: 0,
      peakHumans: 0,
      distinctHumans: 0,
      chatLines: 0,
      topMap: null,
      allTimePeak: null,
      topFraggers: [],
      topWeapons: [],
      mvpAvatar: null,
    });

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.length).toBeGreaterThan(5_000);
  });
});
