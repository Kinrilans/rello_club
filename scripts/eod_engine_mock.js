// scripts/eod_engine_mock.js
// Берёт trust_session.state='closed' за сегодня, считает нетто по trust_ledger,
// создаёт eod_settlement + outgoing_tx (queued). Treasury потом approve -> engine(approved) отправит.

import 'dotenv/config';
import { db } from '../api/db/pool.js';
import { randomUUID } from 'crypto';

const TICK = Number(process.env.EOD_TICK_MS || 5000);

async function settleClosedSessions() {
  const today = new Date().toISOString().slice(0,10);
  const sessions = await db('trust_session')
    .where({ session_date: today, state: 'closed' })
    .select('*')
    .limit(20);

  for (const s of sessions) {
    // уже есть settlement?
    const exists = await db('eod_settlement').where({ session_id: s.id }).first('id');
    if (exists) continue;

    const rows = await db('trust_ledger').where({ session_id: s.id }).select('side','amount_token');
    let a2b = 0, b2a = 0;
    for (const r of rows) {
      const v = Number(r.amount_token || 0);
      if (r.side === 'a_to_b') a2b += v;
      else if (r.side === 'b_to_a') b2a += v;
    }
    const net = a2b - b2a; // >0 => A платит B
    if (net === 0) {
      await db('trust_session').where({ id: s.id }).update({ state: 'settled', settled_at: db.fn.now(), net_amount_token: 0, net_usd: 0 });
      console.log('[eod] zero net, session settled', s.id);
      continue;
    }

    // узнаем pair и компании
    const pair = await db('trust_pair').where({ id: s.pair_id }).first('*');
    const payer = net > 0 ? pair.company_a_id : pair.company_b_id;
    const payee = net > 0 ? pair.company_b_id : pair.company_a_id;
    const amount = Math.abs(net).toFixed(6);

    // создаём settlement
    const settlementId = (await db('eod_settlement').insert({
      id: db.raw('gen_random_uuid()'),
      session_id: s.id,
      payer_company_id: payer,
      payee_company_id: payee,
      token: 'USDT',
      network: 'TRC20',
      amount_token: amount,
      amount_usd: amount,
      status: 'queued',
      created_at: db.fn.now(),
    }).returning('id'))[0].id;

    // outgoing_tx (queued)
    // берём любой hot-кошелёк платформы для TRON/USDT — в реальности будет адрес payee
    const netId = (await db('network').where({ code: 'TRON' }).first('id')).id;
    const tokId = (await db('token').where({ symbol: 'USDT' }).first('id')).id;
    const fromWallet = (await db('platform_wallet').where({ network_id: netId, token_id: tokId, type: 'hot', is_active: true }).first('id')).id;

    const idem = `eod:${settlementId}`;
    await db('outgoing_tx').insert({
      id: db.raw('gen_random_uuid()'),
      network_id: netId,
      token_id: tokId,
      tx_hash: null,
      from_wallet_id: fromWallet,
      to_address: `PAYEE_${payee.toString().slice(0,8)}`, // mock адрес
      amount_token: amount,
      amount_usd: amount,
      status: 'queued',
      deal_id: null,
      payout_request_id: null,
      eod_settlement_id: settlementId,
      idempotency_key: idem,
      created_at: db.fn.now(),
    });

    await db('trust_session').where({ id: s.id }).update({
      state: 'settled', settled_at: db.fn.now(), net_amount_token: amount, net_usd: amount
    });

    console.log('[eod] settlement queued', settlementId, 'amount', amount);
  }
}

function tick() {
  settleClosedSessions()
    .catch(e => console.error('[eod] error', e.message))
    .finally(() => setTimeout(tick, TICK));
}

console.log(`[eod] engine started (tick=${TICK}ms)`);
tick();