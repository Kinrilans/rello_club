// watchers/tron.js
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { db } from '../api/db/pool.js';
import { emitEvent } from '../shared/webhooks.js';

const MOCK = String(process.env.MOCK_CHAIN || 'true') === 'true';
const TOKEN = (process.env.MOCK_TOKEN || 'USDT').toUpperCase();
const TICK_MS = Number(process.env.MOCK_INTERVAL_MS || 7000);
const REQ_CONF = Number(process.env.MOCK_CONFIRMATIONS || 3);
const PASS_THROUGH = true;

async function getIds() {
  const net = await db('network').where({ code: 'TRON' }).first('id');
  const tok = await db('token').where({ symbol: TOKEN }).first('id');
  if (!net || !tok) throw new Error('Missing TRON/USDT|USDC in dictionaries');
  return { network_id: net.id, token_id: tok.id };
}

async function getHotWalletId(network_id, token_id) {
  const row = await db('platform_wallet')
    .where({ network_id, token_id, type: 'hot', is_active: true })
    .first('id');
  if (!row) throw new Error('[watcher-mock] no hot wallet found');
  return row.id;
}

async function createIncoming({ network_id, token_id }) {
  const tx_hash = `0x${randomUUID().replace(/-/g, '')}`;
  const from = 'TMOCK_FROM_' + tx_hash.slice(2, 8);
  const to = 'TMOCK_TO_' + tx_hash.slice(8, 14);
  const amount = '1.000000';

  const id = randomUUID();
  await db('incoming_tx').insert({
    id,
    network_id,
    token_id,
    tx_hash,
    from_address: from,
    to_address: to,
    amount_token: amount,
    amount_usd: null,
    confirmations: 0,
    status: 'seen',
    deal_id: null,
    deposit_id: null,
    created_at: db.fn.now(),
  });

  console.log(`[watcher-mock] incoming ${TOKEN} tx=${tx_hash} amount=${amount}`);
  emitEvent('pay_in.detected', {
    id, network: 'TRON', token: TOKEN, tx_hash, from_address: from, to_address: to, amount_token: amount
  }, `in:${tx_hash}`);
}

async function bumpConfsAndQueue({ network_id, token_id }) {
  const rows = await db('incoming_tx')
    .where({ network_id, token_id })
    .whereIn('status', ['seen', 'confirmed'])
    .orderBy('created_at', 'desc')
    .limit(50);

  for (const r of rows) {
    if (r.status === 'seen' && (r.confirmations || 0) < REQ_CONF) {
      const next = (r.confirmations || 0) + 1;
      await db('incoming_tx').where({ id: r.id }).update({ confirmations: next });
      console.log(`[watcher-mock] +1 conf tx=${r.tx_hash} -> ${next}/${REQ_CONF}`);
    }

    const confs = Math.min(REQ_CONF, (r.confirmations || 0) + (r.status === 'seen' ? 1 : 0));
    if (confs >= REQ_CONF && r.status !== 'confirmed') {
      await db('incoming_tx').where({ id: r.id }).update({ status: 'confirmed', confirmations: REQ_CONF });
      emitEvent('pay_in.confirmed', {
        id: r.id, network: 'TRON', token: TOKEN, tx_hash: r.tx_hash, amount_token: r.amount_token
      }, `in:${r.tx_hash}`);

      if (PASS_THROUGH) {
        const from_wallet_id = await getHotWalletId(network_id, token_id);
        const idem = `pt:${r.tx_hash}`;
        try {
          await db('outgoing_tx').insert({
            id: randomUUID(),
            network_id,
            token_id,
            tx_hash: null,
            from_wallet_id,
            to_address: r.from_address,
            amount_token: r.amount_token,
            amount_usd: null,
            status: 'queued',
            deal_id: r.deal_id || null,
            payout_request_id: null,
            eod_settlement_id: null,
            idempotency_key: idem,
            created_at: db.fn.now(),
          });
          console.log(`[watcher-mock] queued payout (idempotency=${idem})`);
          emitEvent('payout.queued', {
            to_address: r.from_address, amount_token: r.amount_token, token: TOKEN, network: 'TRON'
          }, idem);
        } catch (e) {
          if (!String(e.message).includes('uq_outgoing_idem')) throw e;
        }
      }
    }
  }
}

async function tick() {
  try {
    const ids = await getIds();
    await createIncoming(ids);
    await bumpConfsAndQueue(ids);
  } catch (e) {
    console.error('[watcher-mock] error:', e.message);
  } finally {
    setTimeout(tick, TICK_MS);
  }
}

if (!MOCK) {
  console.log('[watcher] MOCK_CHAIN=false — real integration later');
} else {
  console.log(`[watcher] MOCK_CHAIN=true — ${TOKEN} every ${TICK_MS} ms, CONF=${REQ_CONF}`);
  tick();
}