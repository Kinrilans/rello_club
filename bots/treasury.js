// bots/treasury.js
import { db } from '../api/db/pool.js';
import { getLang, setLang, t, ensureIdentity, findCompanyBySlug, getOrCreateTrustPair, getOrCreateTodaySession, addTrustLedger, parsePositiveAmount } from './helpers.js';
import { Markup } from 'telegraf';

function menu(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'treasury.menu_payouts'), 'treasury:payouts')],
    [Markup.button.callback(t(lang, 'treasury.menu_incoming'), 'treasury:incoming')],
    [Markup.button.callback(t(lang, 'treasury.menu_stats'), 'treasury:stats')],
    [Markup.button.callback('EOD open', 'treasury:eod_open'), Markup.button.callback('EOD close', 'treasury:eod_close')],
    [Markup.button.callback('EOD add A→B', 'treasury:eod_add:a2b'), Markup.button.callback('EOD add B→A', 'treasury:eod_add:b2a')],
    [Markup.button.callback(t(lang, 'menu.lang_ru'), 'treasury:lang:ru'), Markup.button.callback(t(lang, 'menu.lang_en'), 'treasury:lang:en')]
  ]);
}
const CAP = Number(process.env.CAP_MAX_PER_TX_USD || 0);
const REQ_CODE = String(process.env.TREASURY_2FA_CODE || '').trim();

function fmt(a) { return a; }

export default (bot) => {
  bot.start(async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.reply(`*${t(lang, 'treasury.start_title')}*\n${t(lang, 'treasury.start_hint')}\n\nEOD команды: /eod_open <partner_slug>, /eod_add <partner_slug> <a2b|b2a> <amount>, /eod_close <partner_slug>`, { parse_mode: 'Markdown', ...menu(lang) });
  });

  bot.command('lang', async (ctx) => {
    const arg = (ctx.message?.text || '').split(/\s+/)[1];
    await setLang(ctx, arg === 'en' ? 'en' : 'ru');
    const lang = await getLang(ctx);
    await ctx.reply(t(lang, 'common.lang_set'), menu(lang));
  });

  // ==== payouts (как раньше, с approve/reject) ====
  bot.command('payouts', async (ctx) => {
    const lang = await getLang(ctx);
    const rows = await db('outgoing_tx')
      .whereIn('status', ['queued', 'approved', 'signed', 'broadcast'])
      .orderBy([{ column: 'status', order: 'asc' }, { column: 'created_at', order: 'desc' }])
      .limit(10)
      .select('id', 'to_address', 'amount_token', 'status', 'tx_hash', 'created_at');
    if (!rows.length) return ctx.reply(t(lang, 'treasury.payouts_empty'), menu(lang));
    for (const r of rows) {
      const base = `${r.status.toUpperCase()} • ${fmt(r.amount_token)} → ${r.to_address}${r.tx_hash ? `\n   tx: ${r.tx_hash}` : ''}`;
      if (r.status === 'queued') {
        await ctx.reply(base, Markup.inlineKeyboard([[Markup.button.callback('Approve', `treasury:approve:${r.id}`), Markup.button.callback('Reject', `treasury:reject:${r.id}`)]]));
      } else {
        await ctx.reply(base);
      }
    }
  });
  bot.command('approve', async (ctx) => {
    const [, id, code] = (ctx.message?.text || '').trim().split(/\s+/);
    const row = id && await db('outgoing_tx').where({ id }).first('*');
    if (!id || !row) return ctx.reply('Формат: /approve <payout_id> <2fa_code>', menu(await getLang(ctx)));
    if (REQ_CODE && code !== REQ_CODE) return ctx.reply('Неверный 2FA код.', menu(await getLang(ctx)));
    if (row.status !== 'queued') return ctx.reply('Задача уже обработана.', menu(await getLang(ctx)));
    const amtUSD = Number(row.amount_usd || row.amount_token || 0);
    if (CAP > 0 && amtUSD > CAP) return ctx.reply(`Превышает CAP ${CAP} USD.`, menu(await getLang(ctx)));
    await db('outgoing_tx').where({ id }).update({ status: 'approved' });
    await ctx.reply(`Approved: ${id}`, menu(await getLang(ctx)));
  });
  bot.command('reject', async (ctx) => {
    const [, id, code] = (ctx.message?.text || '').trim().split(/\s+/);
    const row = id && await db('outgoing_tx').where({ id }).first('*');
    if (!id || !row) return ctx.reply('Формат: /reject <payout_id> <2fa_code>', menu(await getLang(ctx)));
    if (REQ_CODE && code !== REQ_CODE) return ctx.reply('Неверный 2FA код.', menu(await getLang(ctx)));
    if (row.status !== 'queued') return ctx.reply('Задача уже обработана.', menu(await getLang(ctx)));
    await db('outgoing_tx').where({ id }).update({ status: 'failed' });
    await ctx.reply(`Rejected: ${id}`, menu(await getLang(ctx)));
  });

  // ==== incoming/stats (как раньше) ====
  bot.command('incoming', async (ctx) => {
    const lang = await getLang(ctx);
    const rows = await db('incoming_tx').orderBy('created_at', 'desc').limit(10)
      .select('tx_hash', 'from_address', 'to_address', 'amount_token', 'confirmations', 'status', 'created_at');
    if (!rows.length) return ctx.reply(t(lang, 'treasury.incoming_empty'), menu(lang));
    const lines = rows.map((r, i) => `${i + 1}. ${r.status.toUpperCase()} • conf=${r.confirmations} • ${fmt(r.amount_token)}\n   from ${r.from_address} → ${r.to_address}`).join('\n');
    await ctx.reply(lines, menu(lang));
  });
  bot.command('stats', async (ctx) => {
    const [[{ c: in_total }], [{ c: in_conf }], [{ c: out_q }], [{ c: out_appr }], [{ c: out_c }]] = await Promise.all([
      db('incoming_tx').count('* as c'),
      db('incoming_tx').where({ status: 'confirmed' }).count('* as c'),
      db('outgoing_tx').where({ status: 'queued' }).count('* as c'),
      db('outgoing_tx').where({ status: 'approved' }).count('* as c'),
      db('outgoing_tx').where({ status: 'confirmed' }).count('* as c'),
    ]);
    await ctx.reply(`Incoming: total=${in_total} confirmed=${in_conf}\nPayouts: queued=${out_q} approved=${out_appr} confirmed=${out_c}`, menu(await getLang(ctx)));
  });

  // ==== EOD: open/add/close =====
  bot.command('eod_open', async (ctx) => {
    const partnerSlug = (ctx.message?.text || '').split(/\s+/)[1];
    const { company, member } = await ensureIdentity(ctx);
    const partner = await findCompanyBySlug(partnerSlug);
    if (!partner) return ctx.reply('Компания не найдена.', menu(await getLang(ctx)));
    const pair = await getOrCreateTrustPair(company.id, partner.id, member.id);
    const ses = await getOrCreateTodaySession(pair.id);
    await ctx.reply(`EOD session (today): ${ses.id} state=${ses.state}`, menu(await getLang(ctx)));
  });

  // /eod_add <partner_slug> <a2b|b2a> <amount>
  bot.command('eod_add', async (ctx) => {
    const [, slug, sideArg, amountArg] = (ctx.message?.text || '').trim().split(/\s+/);
    const side = sideArg === 'a2b' ? 'a_to_b' : sideArg === 'b2a' ? 'b_to_a' : null;
    const amount = parsePositiveAmount(amountArg);
    if (!slug || !side || !amount) return ctx.reply('Формат: /eod_add <partner_slug> <a2b|b2a> <amount>', menu(await getLang(ctx)));

    const { company, member } = await ensureIdentity(ctx);
    const partner = await findCompanyBySlug(slug);
    if (!partner) return ctx.reply('Компания не найдена.', menu(await getLang(ctx)));
    const pair = await getOrCreateTrustPair(company.id, partner.id, member.id);
    const ses = await getOrCreateTodaySession(pair.id);
    if (ses.state !== 'open') return ctx.reply(`Сессия не в состоянии open (${ses.state}).`, menu(await getLang(ctx)));

    await addTrustLedger(ses.id, null, side, amount);
    await ctx.reply(`Добавлено: ${side} ${amount} (session=${ses.id})`, menu(await getLang(ctx)));
  });

  bot.command('eod_close', async (ctx) => {
    const partnerSlug = (ctx.message?.text || '').split(/\s+/)[1];
    const { company, member } = await ensureIdentity(ctx);
    const partner = await findCompanyBySlug(partnerSlug);
    if (!partner) return ctx.reply('Компания не найдена.', menu(await getLang(ctx)));
    const pair = await getOrCreateTrustPair(company.id, partner.id, member.id);
    const ses = await getOrCreateTodaySession(pair.id);
    if (ses.state !== 'open') return ctx.reply(`Сессия уже ${ses.state}.`, menu(await getLang(ctx)));
    await db('trust_session').where({ id: ses.id }).update({ state: 'closed', closed_at: db.fn.now() });
    await ctx.reply(`Сессия закрыта: ${ses.id}. Движок EOD рассчитает нетто и поставит выплату.`, menu(await getLang(ctx)));
  });

  // inline shortcuts
  bot.action('treasury:payouts', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/payouts'));
  bot.action('treasury:incoming', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/incoming'));
  bot.action('treasury:stats', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/stats'));
  bot.action('treasury:eod_open', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/eod_open partner-slug'));
  bot.action('treasury:eod_close', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/eod_close partner-slug'));
  bot.action('treasury:eod_add:a2b', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/eod_add partner-slug a2b 100'));
  bot.action('treasury:eod_add:b2a', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/eod_add partner-slug b2a 100'));
  bot.action('treasury:lang:ru', async (ctx) => { await setLang(ctx, 'ru'); await ctx.answerCbQuery('RU'); await ctx.reply('Язык: RU', menu('ru')); });
  bot.action('treasury:lang:en', async (ctx) => { await setLang(ctx, 'en'); await ctx.answerCbQuery('EN'); await ctx.reply('Language: EN', menu('en')); });
};