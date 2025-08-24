// scripts/payout_engine_mock.js
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { db } from '../api/db/pool.js';
import { emitEvent } from '../shared/webhooks.js';

const TICK_MS = Number(process.env.ENGINE_TICK_MS || 3000);
const STEP_MS = Number(process.env.ENGINE_STEP_MS || 2000);
const BATCH = Number(process.env.ENGINE_BATCH || 3);
const PICK = (process.env.ENGINE_PICK_STATUS || 'approved').toLowerCase();

async function claimBatch(limit) {
  const rows = await db('outgoing_tx')
    .where({ status: PICK })
    .orderBy('created_at', 'asc')
    .limit(limit)
    .select('id');

  const claimed = [];
  for (const { id } of rows) {
    const updated = await db('outgoing_tx')
      .where({ id, status: PICK })
      .update({ status: 'signed' })
      .returning('*');
    if (updated.length) {
      claimed.push(updated[0]);
      emitEvent('payout.signed', { id: updated[0].id }, `out:${updated[0].id}`);
    }
  }
  return claimed;
}

async function setBroadcast(id) {
  const txHash = `0x${randomUUID().replace(/-/g, '')}`;
  await db('outgoing_tx').where({ id, status: 'signed' }).update({ status: 'broadcast', tx_hash: txHash });
  emitEvent('payout.broadcast', { id, tx_hash: txHash }, `out:${id}`);
  return txHash;
}

async function setConfirmed(id) {
  await db('outgoing_tx').where({ id, status: 'broadcast' }).update({ status: 'confirmed' });
  emitEvent('payout.confirmed', { id }, `out:${id}`);
}

async function cycleOnce() {
  try {
    const tasks = await claimBatch(BATCH);
    if (!tasks.length) { console.log(`[engine] no ${PICK} payouts`); return; }

    for (const t of tasks) {
      console.log('[engine] signed', t.id);
      setTimeout(async () => {
        try {
          const txh = await setBroadcast(t.id);
          console.log('[engine] broadcast', t.id, txh);
          setTimeout(async () => {
            try { await setConfirmed(t.id); console.log('[engine] confirmed', t.id); }
            catch (e) { console.error('[engine] confirm error', t.id, e.message); }
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

function tick() { cycleOnce().finally(() => setTimeout(tick, TICK_MS)); }
console.log(`[engine] started (pick=${PICK}, tick=${TICK_MS}ms, step=${STEP_MS}ms, batch=${BATCH})`);
tick();