import { db } from '../api/db/pool.js';
import { balanceUsd } from './ledger.js';

const TIER = (p) => (p || 'S').toUpperCase();
const K = {
  S: Number(process.env.LIMIT_K_S || 1.0),
  M: Number(process.env.LIMIT_K_M || 2.0),
  L: Number(process.env.LIMIT_K_L || 3.0),
  XL: Number(process.env.LIMIT_K_XL || 5.0),
};
const CAP_PER_DEAL = Number(process.env.CAP_PER_DEAL_USD || 500);
const CAP_OPEN_EXPOSURE = Number(process.env.CAP_OPEN_EXPOSURE_USD || 2000);

// !!! где хранить tier? если в схеме нет поля, принимаем 'S' по умолчанию.
// (предлагаю позже добавить company.tier ENUM — см. заметку ниже)
async function companyTier(company_id) {
  const kv = await db('system_kv').where({ key: `company.tier.${company_id}` }).first('value');
  return TIER(kv?.value?.tier);
}

export async function limitsFor(company_id) {
  const tier = await companyTier(company_id);
  const deposit = await balanceUsd(company_id);
  const company_limit = deposit * (K[tier] || 1.0);
  const [{ exp }] = await db('deal')
    .where(builder => builder.where({ initiator_company_id: company_id }).orWhere({ counterparty_company_id: company_id }))
    .whereNot({ state: 'closed' })
    .sum({ exp: 'amount_token' });
  const open_exposure = Number(exp || 0);
  return { tier, deposit, company_limit, open_exposure };
}

export async function canPropose(company_id, amount_usd) {
  const L = await limitsFor(company_id);
  if (CAP_PER_DEAL && amount_usd > CAP_PER_DEAL) return { ok: false, reason: `cap_per_deal ${CAP_PER_DEAL}` };
  if (CAP_OPEN_EXPOSURE && (L.open_exposure + amount_usd) > Math.min(L.company_limit, CAP_OPEN_EXPOSURE)) {
    return { ok: false, reason: `open_exposure ${CAP_OPEN_EXPOSURE} / limit ${L.company_limit}` };
  }
  return { ok: true };
}