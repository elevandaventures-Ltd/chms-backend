import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";

/**
 * SMS via Africa's Talking, used for member notifications (e.g. the welcome
 * message on member creation).
 *
 * Optional infrastructure, exactly like Meilisearch: when AT_USERNAME / AT_API_KEY
 * are unset {@link sendSms} no-ops (logged, never thrown), so a missing SMS
 * provider never blocks or fails the operation that triggered it. Calls go
 * straight to the AT HTTP API over `fetch` — no SDK dependency. Sending is always
 * best-effort: SMS is a side effect, never the source of truth.
 */

export function isSmsConfigured(): boolean {
  return Boolean(config.africasTalking.username && config.africasTalking.apiKey);
}

/** The welcome message template: "Welcome to [Church]! We're glad you're here." */
export function buildWelcomeMessage(churchName: string): string {
  return `Welcome to ${churchName}! We're glad you're here.`;
}

export interface SmsResult {
  sent: boolean;
}

/**
 * Send an SMS to one or more recipients (comma-separated `to`). Resolves to
 * `{ sent: false }` — without throwing — when SMS isn't configured or the request
 * fails, so callers can fire-and-forget. Never rejects.
 */
export async function sendSms(
  to: string,
  message: string,
  log: FastifyBaseLogger,
): Promise<SmsResult> {
  const { username, apiKey, senderId, host } = config.africasTalking;

  if (!username || !apiKey) {
    log.debug("SMS not configured; skipping send");
    return { sent: false };
  }

  try {
    const body = new URLSearchParams({ username, to, message });
    if (senderId) body.set("from", senderId);

    const res = await fetch(new URL("/version1/messaging", host), {
      method: "POST",
      headers: {
        apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!res.ok) {
      log.warn({ status: res.status }, "SMS send returned a non-2xx response");
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    log.warn({ err }, "SMS send failed");
    return { sent: false };
  }
}
