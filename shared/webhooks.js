// shared/webhooks.js
import 'dotenv/config';
import crypto from 'crypto';

const URL = process.env.WEBHOOK_URL?.trim();
const SECRET = process.env.WEBHOOK_SECRET || '';
const TIMEOUT = Number(process.env.WEBHOOK_TIMEOUT_MS || 3000);

// Safe POST with HMAC signature from tech/webhooks_events_v1.md (упрощённый)
export async function emitEvent(type, payload, idempotencyKey) {
  if (!URL) return; // выключено
  const ts = Date.now().toString();
  const body = JSON.stringify({ type, ts, payload });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-event': type,
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sig,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[webhook] non-200', res.status, txt.slice(0, 200));
    }
  } catch (e) {
    console.warn('[webhook] error', e.message);
  }
}