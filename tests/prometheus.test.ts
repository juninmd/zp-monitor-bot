import { describe, expect, test } from "bun:test";
import { monitorCounters, monitorState, setWsClientCount } from "../src/monitorState";
import { formatPrometheusMetrics } from "../src/prometheus";

describe("prometheus", () => {
  test("exports Prometheus 0.0.4 text format with live monitor and telemetry counters", () => {
    monitorState.connection.online = true;
    monitorState.telemetry.zombies = 6;
    monitorState.telemetry.humans = 8;
    monitorCounters.a2sErrors = 2;
    setWsClientCount(3);

    const output = formatPrometheusMetrics(420);
    expect(output).toContain("# TYPE zp_bot_uptime_seconds gauge");
    expect(output).toContain("zp_bot_uptime_seconds 420");
    expect(output).toContain("zp_server_online 1");
    expect(output).toContain("zp_round_zombies 6");
    expect(output).toContain("zp_round_humans 8");
    expect(output).toContain("zp_ws_clients 3");
    expect(output).toContain('zp_poll_errors_total{kind="a2s"} 2');
  });
});
