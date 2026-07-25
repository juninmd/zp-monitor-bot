// Manual smoke test: bun run src/agent/smoketest.ts
// Exercises the LiteLLM-backed ADK agent end to end (chat + tool call +
// short-term memory), using a fake steamId so it doesn't touch real players.
// Also hits real RCON (zp_give_ammo against a nonexistent "SmokeTestBot"
// player, which safely no-ops) to prove the LiteLLM -> tool -> RCON pipe works.
import { handlePlayerMessage } from "./agent";

async function main() {
  const player = { name: "SmokeTestBot", uid: "999", steamId: "STEAM_SMOKETEST" };

  console.log("--- turn 1: plain chat ---");
  console.log("reply:", await handlePlayerMessage(player, "!ia oi, tudo bem?"));

  console.log("--- turn 2: tool call (ammo) ---");
  console.log("reply:", await handlePlayerMessage(player, "!ia me dá uns ammo packs aí"));

  console.log("--- turn 3: memory check ---");
  console.log(
    "reply:",
    await handlePlayerMessage(player, "!ia quantos AP vc acabou de me dar mesmo?"),
  );
}

main().catch((err) => {
  console.error("smoketest failed:", err);
  process.exit(1);
});
