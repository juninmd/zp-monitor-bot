import { config } from "./config";

const MIN_INTERVAL_MS = 1200;
const queue: string[] = [];
let draining = false;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const text = queue.shift()!;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: config.telegramChatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        },
      );
      if (!res.ok) {
        console.error("[telegram] send failed", res.status, await res.text());
      }
    } catch (err) {
      console.error("[telegram] send error", err);
    }
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
  draining = false;
}

export function sendTelegram(text: string): void {
  queue.push(text);
  void drain();
}

export async function sendTelegramPhoto(photo: Buffer, caption?: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", config.telegramChatId);
  if (caption) form.append("caption", caption);
  form.append("photo", new Blob([photo], { type: "image/png" }), "radar.png");

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendPhoto`,
      { method: "POST", body: form },
    );
    if (!res.ok) {
      console.error("[telegram] sendPhoto failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("[telegram] sendPhoto error", err);
  }
}

export { escapeHtml };
