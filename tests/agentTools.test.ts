import { describe, expect, test } from "bun:test";
import type { Context } from "@google/adk";
import { buildToolsForPlayer } from "../src/agent/tools";

describe("player tool matrix", () => {
  test("executes every tool through allowlisted RCON commands without touching a real server", async () => {
    const commands: string[] = [];
    const notifications: string[] = [];
    const tools = buildToolsForPlayer(
      { name: 'Smoke";quit', uid: "999", steamId: "STEAM_SMOKE" },
      {
        runRcon: async (command) => {
          commands.push(command);
          return "ok";
        },
        notify: (message) => {
          notifications.push(message);
        },
        consume: () => true,
        cooldownRemaining: () => 0,
      },
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const context = undefined as unknown as Context;

    await byName.get("respawn_player")?.runAsync({ args: {}, toolContext: context });
    await byName.get("give_ammo_packs")?.runAsync({ args: { amount: 17 }, toolContext: context });
    await byName.get("unstick_player")?.runAsync({ args: {}, toolContext: context });
    await byName
      .get("change_map")
      ?.runAsync({ args: { mapName: "zm_dust2" }, toolContext: context });

    expect(commands).toEqual([
      'zp_respawn "Smokequit"',
      'zp_give_ammo "Smokequit" 17',
      'amx_slap "Smokequit" 0',
      "changelevel zm_dust2",
    ]);
    expect(notifications).toHaveLength(4);
  });
});
