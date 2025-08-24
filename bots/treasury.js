// bots/treasury.js
import { db } from '../api/db/pool.js';
import { getLang, setLang, t } from './helpers.js';
import { Markup } from 'telegraf';

function menu(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'treasury.menu_payouts'), 'treasury:payouts')],
    [Markup.button.callback(t(lang, 'treasury.menu_incoming'), 'treasury:incoming')],
    [Markup.button.callback(t(lang, 'treasury.menu_stats'), 'treasury:stats')],
    [Markup.button.callback(t(lang, 'menu.lang_ru'), 'treasury:lang:ru'), Markup.button.callback(t(lang, 'menu.lang_en'), 'treasury:lang:en')]
  ]);
}

function fmt(a) { return a; }

export default (bot) => {
  bot.start(async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.reply(`*${t(lang, 'treasury.start_title')}*\n${t(lang, 'treasury.start_hint')}`, { parse_mode: 'Markdown', ...menu(lang) });
  });

  bot.command('lang', async (ctx) => {
    const arg = (ctx.message?.text || '').split(/\s+/)[1];
    await setLang(ctx, arg === 'en' ? 'en' : 'ru');
    const lang = await getLang(ctx);
    await ctx.reply(t(lang, 'common.lang_set'), menu(lang));
  });

  bot.command('payouts', async (ctx) => {
    const lang = await getLang(ctx);
    const rows = await db('outgoing_tx')
      .whereIn('status', ['queued', 'signed', 'broadcast'])
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('id', 'to_address', 'amount_token', 'status', 'tx_hash', 'created_at');

    if (!rows.length) return ctx.reply(t(lang, 'treasury.payouts_empty'), menu(lang));
    const lines = rows.map((r, i) => {
      const base = `${i + 1}. ${r.status.toUpperCase()} • ${fmt(r.amount_token)} → ${r.to_address}`;
      const tx = r.tx_hash ? `\n   tx: ${r.tx_hash}` : '';
      return base + tx;
    }).join('\n');
    await ctx.reply(lines, menu(lang));
  });

  bot.command('incoming', async (ctx) => {
    const lang = await getLang(ctx);
    const rows = await db('incoming_tx')
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('tx_hash', 'from_address', 'to_address', 'amount_token', 'confirmations', 'status', 'created_at');

    if (!rows.length) return ctx.reply(t(lang, 'treasury.incoming_empty'), menu(lang));
    const lines = rows.map((r, i) =>
      `${i + 1}. ${r.status.toUpperCase()} • conf=${r.confirmations} • ${fmt(r.amount_token)}\n   from ${r.from_address} → ${r.to_address}`
    ).join('\n');
    await ctx.reply(lines, menu(lang));
  });

  bot.command('stats', async (ctx) => {
    const lang = await getLang(ctx);
    const [[{ c: in_total }], [{ c: in_conf }], [{ c: out_q }], [{ c: out_c }]] = await Promise.all([
      db('incoming_tx').count('* as c'),
      db('incoming_tx').where({ status: 'confirmed' }).count('* as c'),
      db('outgoing_tx').whereIn('status', ['queued', 'signed', 'broadcast']).count('* as c'),
      db('outgoing_tx').where({ status: 'confirmed' }).count('* as c'),
    ]);
    await ctx.reply(t(lang, 'treasury.stats', { in_total, in_conf, out_q, out_c }), menu(lang));
  });

  // inline handlers
  bot.action('treasury:payouts', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/payouts'));
  bot.action('treasury:incoming', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/incoming'));
  bot.action('treasury:stats', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/stats'));
  bot.action('treasury:lang:ru', async (ctx) => { await setLang(ctx, 'ru'); await ctx.answerCbQuery('RU'); await ctx.reply('Язык: RU', menu('ru')); });
  bot.action('treasury:lang:en', async (ctx) => { await setLang(ctx, 'en'); await ctx.answerCbQuery('EN'); await ctx.reply('Language: EN', menu('en')); });
};