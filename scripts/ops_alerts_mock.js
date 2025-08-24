// scripts/ops_alerts_mock.js
import 'dotenv/config';
import { db } from '../api/db/pool.js';
import crypto from 'crypto';

const URL = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
const SECRET = process.env.OPS_ALERT_SECRET || '';
const Q_MIN = Number(process.env.OPS_STUCK_QUEUED_MIN || 15);
const B_MIN = Number(process.env.OPS_STUCK_BROADCAST_MIN || 30);

function nowUtc() { return new Date(); }

async function sendAlert(text) {
  console.warn('[ALERT]', text);
  if (!URL) return;
  const ts = Date.now().toString();
  const body = JSON.stringify({ ts, text });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  try {
    await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig }, body });
  } catch (e) {
    console.warn('[ops-webhook] error', e.message);
  }
}

async function check() {
  const q = await db.raw(
    `SELECT count(*)::int AS c
     FROM rello.outgoing_tx
     WHERE status='queued' AND created_at < now() - interval '${Q_MIN} minutes'`
  );
  const b = await db.raw(
    `SELECT count(*)::int AS c
     FROM rello.outgoing_tx
     WHERE status='broadcast' AND created_at < now() - interval '${B_MIN} minutes'`
  );
  const qc = q.rows[0].c, bc = b.rows[0].c;
  if (qc > 0) await sendAlert(`Stuck queued payouts > ${Q_MIN}m: ${qc}`);
  if (bc > 0) await sendAlert(`Stuck broadcast payouts > ${B_MIN}m: ${bc}`);
}

setInterval(check, 60_000);
console.log('[ops] alerts started');