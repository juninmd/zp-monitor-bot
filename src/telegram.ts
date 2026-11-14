import { config } from "./config";

const MIN_INTERVAL_MS = 1200;
export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

interface TextItem {
  chatId: string;
  text: string;
  html: boolean;
  replyMarkup?: InlineKeyboardMarkup;
  resolve: () => void;
}
interface PhotoItem {
  chatId: string;
  photo: Buffer;
  caption?: string;
  replyMarkup?: InlineKeyboardMarkup;
  resolve: () => void;
}

const queue: TextItem[] = [];
const photoQueue: PhotoItem[] = [];
let draining = false;
let drainingPhotos = false;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: item.chatId,
            text: item.text,
            ...(item.html ? { parse_mode: "HTML" } : {}),
            ...(item.replyMarkup ? { reply_markup: item.replyMarkup } : {}),
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
    item.resolve();
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
  draining = false;
}

async function drainPhotos(): Promise<void> {
  if (drainingPhotos) return;
  drainingPhotos = true;
  while (photoQueue.length > 0) {
    const item = photoQueue.shift();
    if (!item) break;
    const form = new FormData();
    form.append("chat_id", item.chatId);
    if (item.caption) {
      form.append("caption", item.caption);
      form.append("parse_mode", "HTML");
    }
    if (item.replyMarkup) {
      form.append("reply_markup", JSON.stringify(item.replyMarkup));
    }
    form.append("photo", new Blob([item.photo], { type: "image/png" }), "snapshot.png");
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendPhoto`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.error("[telegram] sendPhoto failed", res.status, await res.text());
      }
    } catch (err) {
      console.error("[telegram] sendPhoto error", err);
    }
    item.resolve();
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
  drainingPhotos = false;
}

export function sendTelegram(text: string): void {
  void sendTelegramTo(config.telegramChatId, text, true);
}

export function sendTelegramTo(
  chatId: string,
  text: string,
  html = false,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  return new Promise((resolve) => {
    queue.push({ chatId, text, html, replyMarkup, resolve });
    void drain();
  });
}

/** Envia foto para o chat padrão; a fila respeita o rate limit do Bot API. */
export function sendTelegramPhoto(photo: Buffer, caption?: string): Promise<void> {
  return sendTelegramPhotoTo(config.telegramChatId, photo, caption);
}

export function sendTelegramPhotoTo(
  chatId: string,
  photo: Buffer,
  caption?: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  return new Promise((resolve) => {
    photoQueue.push({ chatId, photo, caption, replyMarkup, resolve });
    void drainPhotos();
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // best-effort ack
  }
}

export { escapeHtml };
