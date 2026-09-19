import { expect, test } from "bun:test";
import { decideMapRotation, type MapRotationConfig } from "../src/mapRotation";

const baseConfig: MapRotationConfig = {
  enabled: true,
  emptyMinutes: 15,
  cooldownMinutes: 60,
  popularMaps: ["zm_dust2_2k15"],
  candidateMaps: ["zm_lost_temple", "zm_deleted_scryptmap", "zm_dust2_2k15"],
};

test("não roda antes do limiar de minutos vazio", () => {
  const decision = decideMapRotation("zm_unpopular", 0, 10, null, baseConfig);
  expect(decision.rotate).toBe(false);
});

test("não roda se o mapa atual já é popular", () => {
  const decision = decideMapRotation("zm_dust2_2k15", 0, 30, null, baseConfig);
  expect(decision.rotate).toBe(false);
});

test("não roda se ainda tem gente jogando", () => {
  const decision = decideMapRotation("zm_unpopular", 3, 30, null, baseConfig);
  expect(decision.rotate).toBe(false);
});

test("respeita o cooldown desde a última rotação automática", () => {
  const decision = decideMapRotation("zm_unpopular", 0, 30, 10, baseConfig);
  expect(decision.rotate).toBe(false);
});

test("roda passado o cooldown e escolhe um candidato diferente do atual", () => {
  const decision = decideMapRotation("zm_unpopular", 0, 30, 90, baseConfig);
  expect(decision.rotate).toBe(true);
  expect(decision.targetMap).toBe("zm_lost_temple");
  expect(decision.reason).toContain("zm_unpopular");
  expect(decision.reason).toContain("zm_lost_temple");
});

test("pula o primeiro candidato se ele for o mapa atual", () => {
  const decision = decideMapRotation("zm_lost_temple", 0, 30, null, baseConfig);
  expect(decision.targetMap).toBe("zm_deleted_scryptmap");
});

test("lista de candidatos vazia não roda e não estoura exceção", () => {
  const decision = decideMapRotation("zm_unpopular", 0, 30, null, {
    ...baseConfig,
    candidateMaps: [],
  });
  expect(decision.rotate).toBe(false);
  expect(decision.targetMap).toBeNull();
});

test("feature desligada nunca roda", () => {
  const decision = decideMapRotation("zm_unpopular", 0, 999, null, {
    ...baseConfig,
    enabled: false,
  });
  expect(decision.rotate).toBe(false);
});
