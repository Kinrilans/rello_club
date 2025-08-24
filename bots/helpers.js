// bots/helpers.js
import { db } from '../api/db/pool.js';
import texts from '../shared/i18n.json' with { type: 'json' };

// --- i18n ---
export async function getLang(ctx) {
  const uid = ctx.from?.id;
  const key = `lang.telegram.${uid}`;
  const row = await db('system_kv').where({ key }).first('value');
  const lang = row?.value?.lang;
  return (lang === 'en' || lang === 'ru') ? lang : 'ru';
}
export async function setLang(ctx, lang) {
  const uid = ctx.from?.id;
  const key = `lang.telegram.${uid}`;
  const value = { lang: (lang === 'en' ? 'en' : 'ru') };
  const exists = await db('system_kv').where({ key }).first('key');
  if (exists) await db('system_kv').where({ key }).update({ value, updated_at: db.fn.now() });
  else await db('system_kv').insert({ key, value, updated_at: db.fn.now() });
}
export function t(lang, key, params = {}) {
  const parts = key.split('.');
  let node = texts[lang] || texts.ru;
  for (const p of parts) node = node?.[p];
  let s = (typeof node === 'string' ? node : key);
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// --- schema helpers ---
export async function getIds() {
  const net = await db('network').where({ code: 'TRON' }).first('id');
  if (!net) throw new Error('network TRON not found');
  const usdt = await db('token').where({ symbol: 'USDT' }).first('id');
  if (!usdt) throw new Error('token USDT not found');
  return { network_id: net.id, token_id: usdt.id };
}
export function makeSlug(name, tgId) {
  const base = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || `company-${tgId}`;
}
export async function ensureIdentity(ctx) {
  const tgId = ctx.from?.id;
  const display = ctx.from?.username || ctx.from?.first_name || `user-${tgId}`;
  let member = await db('member').where({ telegram_id: tgId }).first('*');

  if (!member) {
    const companyId = (await db('company')
      .insert({
        id: db.raw('gen_random_uuid()'),
        name: `Company of ${display}`,
        slug: makeSlug(display, tgId),
        status: 'active',
        timezone: 'Europe/Warsaw',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      }).returning('id'))[0].id;

    const memberId = (await db('member')
      .insert({
        id: db.raw('gen_random_uuid()'),
        company_id: companyId,
        telegram_id: tgId,
        display_name: display,
        status: 'active',
        is_2fa_enabled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      }).returning('id'))[0].id;

    await db('role_assignment').insert({
      id: db.raw('gen_random_uuid()'),
      member_id: memberId,
      role: 'trader',
      created_at: db.fn.now(),
    });

    member = await db('member').where({ id: memberId }).first('*');
  }
  const company = await db('company').where({ id: member.company_id }).first('*');
  return { company, member };
}

// --- validations ---
export function isValidTronAddress(addr) {
  return /^T[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(addr || '').trim());
}
export function parsePositiveAmount(s) {
  const m = String(s || '').trim();
  if (!/^\d+(\.\d+)?$/.test(m)) return null;
  const n = Number(m);
  if (!(n > 0)) return null;
  return m; // keep string for NUMERIC
}

// --- trust/eod helpers ---
export async function findCompanyBySlug(slug) {
  if (!slug) return null;
  return db('company').where({ slug }).first('*');
}
export async function getOrCreateTrustPair(companyAId, partnerId, createdBy) {
  const low = companyAId < partnerId ? companyAId : partnerId;
  const high = companyAId < partnerId ? partnerId : companyAId;
  let pair = await db('trust_pair').where({ company_low_id: low, company_high_id: high }).first('*');
  if (!pair) {
    const id = (await db('trust_pair').insert({
      id: db.raw('gen_random_uuid()'),
      company_a_id: companyAId,
      company_b_id: partnerId,
      company_low_id: low,
      company_high_id: high,
      status: 'proposed',
      tokens: ['USDT'],
      networks: ['TRC20'],
      timezone: 'Europe/Warsaw',
      created_by: createdBy,
      created_at: db.fn.now(),
    }).returning('id'))[0].id;
    pair = await db('trust_pair').where({ id }).first('*');
  }
  return pair;
}
export async function getOrCreateTodaySession(pairId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC ok for MVP)
  let ses = await db('trust_session').where({ pair_id: pairId, session_date: today }).first('*');
  if (!ses) {
    const id = (await db('trust_session').insert({
      id: db.raw('gen_random_uuid()'),
      pair_id: pairId,
      session_date: today,
      state: 'open',
      net_token: 'USDT',
      created_at: db.fn.now(),
    }).returning('id'))[0].id;
    ses = await db('trust_session').where({ id }).first('*');
  }
  return ses;
}
export async function addTrustLedger(sessionId, dealId, side, amountToken) {
  await db('trust_ledger').insert({
    id: db.raw('gen_random_uuid()'),
    session_id: sessionId,
    deal_id: dealId || db.raw('gen_random_uuid()'), // демо id для записи
    side,                     // 'a_to_b' | 'b_to_a'
    token: 'USDT',
    network: 'TRC20',
    amount_token: amountToken,
    amount_usd: amountToken,  // 1:1
    type: 'deal',
    created_at: db.fn.now(),
  });
}