// scripts/payout_engine_mock.js
// Mock payout engine: берёт queued выплаты и проводит их по статусам
// queued -> signed -> broadcast (ставит tx_hash) -> confirmed

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { db } from '../api/db/pool.js';

const TICK_MS = Number(process.env.ENGINE_TICK_MS || 3000);
const STEP_MS = Number(process.env.ENGINE_STEP_MS || 2000);
// Сколько выплат обрабатывать параллельно за тик
const BATCH = Number(process.env.ENGINE_BATCH || 3);

async function claimQueued(limit) {
  // Забираем старые queued. Клеймим переводом в 'signed', чтобы не забрал другой процесс.
  const rows = await db('outgoing_tx')
    .where({ status: 'queued' })
    .orderBy('created_at', 'asc')
    .limit(limit)
    .select('id');

  const claimed = [];
  for (const { id } of rows) {
    const updated = await db('outgoing_tx')
      .where({ id, status: 'queued' })
      .update({ status: 'signed' })
      .returning('*');
    if (updated.length) claimed.push(updated[0]);
  }
  return claimed;
}

async function setBroadcast(id) {
  const txHash = `0x${randomUUID().replace(/-/g, '')}`;
  await db('outgoing_tx')
    .where({ id, status: 'signed' })
    .update({ status: 'broadcast', tx_hash: txHash });
  return txHash;
}

async function setConfirmed(id) {
  await db('outgoing_tx')
    .where({ id, status: 'broadcast' })
    .update({ status: 'confirmed' });
}

async function cycleOnce() {
  try {
    const tasks = await claimQueued(BATCH);
    if (!tasks.length) {
      console.log('[engine] no queued payouts');
      return;
    }

    for (const t of tasks) {
      console.log('[engine] signed', t.id);

      // небольшая пауза -> broadcast
      setTimeout(async () => {
        try {
          const txh = await setBroadcast(t.id);
          console.log('[engine] broadcast', t.id, txh);

          // ещё пауза -> confirmed
          setTimeout(async () => {
            try {
              await setConfirmed(t.id);
              console.log('[engine] confirmed', t.id);
            } catch (e) {
              console.error('[engine] confirm error', t.id, e.message);
            }
          }, STEP_MS);
        } catch (e) {
          console.error('[engine] broadcast error', t.id, e.message);
        }
      }, STEP_MS);
    }
  } catch (e) {
    console.error('[engine] cycle error:', e.message);
  }
}

function tick() {
  cycleOnce().finally(() => setTimeout(tick, TICK_MS));
}

console.log(`[engine] mock payout engine started (tick=${TICK_MS}ms, step=${STEP_MS}ms, batch=${BATCH})`);
tick();