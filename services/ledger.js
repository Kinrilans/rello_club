import { db } from '../api/db/pool.js';

const PLUS = new Set(['fund', 'adjustment', 'hold_release']);
const MINUS = new Set(['hold_open', 'penalty', 'reserve_trust']);

export async function addLedger(company_id, type, amount_token, ref = {}) {
  await db('deposit_ledger').insert({
    id: db.raw('gen_random_uuid()'),
    company_id,
    type, // fund|hold_open|hold_release|penalty|reserve_trust|adjustment
    token: 'USDT',
    network: 'TRC20',
    amount_token,
    ref,
    created_at: db.fn.now(),
  });
}

export async function balanceUsd(company_id) {
  const rows = await db('deposit_ledger').where({ company_id }).select('type','amount_token');
  let sum = 0;
  for (const r of rows) {
    const v = Number(r.amount_token || 0);
    if (PLUS.has(r.type)) sum += v;
    else if (MINUS.has(r.type)) sum -= v;
  }
  return sum; // 1:1 к USD
}