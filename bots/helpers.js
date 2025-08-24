import { db } from '../api/db/pool.js';
import texts from '../shared/i18n.json' with { type: 'json' }; // <-- фикс JSON-импорта для Node 22+

// --- i18n helpers ---
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
  if (exists) {
    await db('system_kv').where({ key }).update({ value, updated_at: db.fn.now() });
  } else {
    await db('system_kv').insert({ key, value, updated_at: db.fn.now() });
  }
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
      })
      .returning('id'))[0].id;

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
      })
      .returning('id'))[0].id;

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
  return m;
}