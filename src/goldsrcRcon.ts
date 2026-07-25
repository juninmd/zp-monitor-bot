import dgram from "node:dgram";

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

export function buildRconPacket(payload: string): Buffer {
  return Buffer.concat([HEADER, Buffer.from(`${payload}\0`, "ascii")]);
}

export function stripRconReply(message: Buffer): string {
  return message.subarray(4).toString("ascii").replace(/\0+$/, "").replace(/^l/, "");
}

export function parseChallengeReply(message: Buffer): string | null {
  return stripRconReply(message).match(/challenge\s+(?:rcon\s+)?(-?\d+)/i)?.[1] ?? null;
}

export function goldsrcRcon(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 2500,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    let stage: "challenge" | "command" = "challenge";
    let settled = false;
    let reply = "";
    let replyTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (replyTimer) clearTimeout(replyTimer);
      socket.close();
      if (error) reject(error);
      else resolve(reply);
    };

    const timeoutTimer = setTimeout(() => finish(new Error("RCON timeout")), timeoutMs);
    const send = (payload: string): void => {
      socket.send(buildRconPacket(payload), port, host);
    };

    socket.on("error", (error) => finish(error));
    socket.on("message", (message) => {
      if (stage === "challenge") {
        const challenge = parseChallengeReply(message);
        if (!challenge) {
          finish(new Error(`RCON challenge inválido: ${stripRconReply(message).slice(0, 120)}`));
          return;
        }
        stage = "command";
        send(`rcon ${challenge} ${password} ${command}`);
        return;
      }

      reply += stripRconReply(message);
      if (replyTimer) clearTimeout(replyTimer);
      replyTimer = setTimeout(() => finish(), 250);
    });

    socket.bind(() => send("challenge rcon"));
  });
}
