/**
 * Exportador de métricas no formato Prometheus text exposition (0.0.4) para
 * monitoramento do pod no cluster Kubernetes.
 */

import { getMetrics } from "./metrics";
import { monitorCounters, monitorState } from "./monitorState";

export function formatPrometheusMetrics(uptimeSeconds: number): string {
  const daily = getMetrics();
  const lines = [
    "# HELP zp_bot_uptime_seconds Tempo de vida do processo em segundos.",
    "# TYPE zp_bot_uptime_seconds gauge",
    `zp_bot_uptime_seconds ${uptimeSeconds}`,
    "# HELP zp_server_online Indica se o servidor CS 1.6 respondeu ao ultimo A2S (1=online).",
    "# TYPE zp_server_online gauge",
    `zp_server_online ${monitorState.connection.online ? 1 : 0}`,
    "# HELP zp_players_humans Quantidade de jogadores humanos online.",
    "# TYPE zp_players_humans gauge",
    `zp_players_humans ${monitorState.info?.players ?? 0}`,
    "# HELP zp_players_bots Quantidade de bots online.",
    "# TYPE zp_players_bots gauge",
    `zp_players_bots ${monitorState.info?.bots ?? 0}`,
    "# HELP zp_server_fps Engine FPS reportado pelo RCON stats.",
    "# TYPE zp_server_fps gauge",
    `zp_server_fps ${monitorState.rcon.fps ?? 0}`,
    "# HELP zp_server_ping_ms Latencia A2S UDP em ms.",
    "# TYPE zp_server_ping_ms gauge",
    `zp_server_ping_ms ${monitorState.info?.ping ?? 0}`,
    "# HELP zp_round_zombies Zumbis na rodada atual (telemetria ZP).",
    "# TYPE zp_round_zombies gauge",
    `zp_round_zombies ${monitorState.telemetry.zombies}`,
    "# HELP zp_round_humans Humanos na rodada atual (telemetria ZP).",
    "# TYPE zp_round_humans gauge",
    `zp_round_humans ${monitorState.telemetry.humans}`,
    "# HELP zp_kills_today Total de kills entre humanos hoje.",
    "# TYPE zp_kills_today gauge",
    `zp_kills_today ${daily.kills}`,
    "# HELP zp_deaths_today Total de mortes de humanos hoje.",
    "# TYPE zp_deaths_today gauge",
    `zp_deaths_today ${daily.deaths}`,
    "# HELP zp_peak_humans_today Pico de humanos simultaneos hoje.",
    "# TYPE zp_peak_humans_today gauge",
    `zp_peak_humans_today ${daily.peakHumans}`,
    "# HELP zp_ws_clients Conexoes WebSocket ativas no dashboard.",
    "# TYPE zp_ws_clients gauge",
    `zp_ws_clients ${monitorCounters.wsClients}`,
    "# HELP zp_poll_errors_total Erros acumulados de polling por subsistema.",
    "# TYPE zp_poll_errors_total counter",
    `zp_poll_errors_total{kind="a2s"} ${monitorCounters.a2sErrors}`,
    `zp_poll_errors_total{kind="rcon"} ${monitorCounters.rconErrors}`,
    `zp_poll_errors_total{kind="telemetry"} ${monitorCounters.telemetryErrors}`,
  ];
  return `${lines.join("\n")}\n`;
}
