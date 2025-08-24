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
const CAP = Number(process.env.CAP_MAX_PER_TX_USD || 0);
const REQ_CODE = String(process.env.TREASURY_2FA_CODE || '').trim();

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
      .whereIn('status', ['queued', 'approved', 'signed', 'broadcast'])
      .orderBy([{ column: 'status', order: 'asc' }, { column: 'created_at', order: 'desc' }])
      .limit(10)
      .select('id', 'to_address', 'amount_token', 'status', 'tx_hash', 'created_at');

    if (!rows.length) return ctx.reply(t(lang, 'treasury.payouts_empty'), menu(lang));

    for (const r of rows) {
      const base = `${r.status.toUpperCase()} • ${fmt(r.amount_token)} → ${r.to_address}${r.tx_hash ? `\n   tx: ${r.tx_hash}` : ''}`;
      if (r.status === 'queued') {
        await ctx.reply(
          base,
          Markup.inlineKeyboard([
            [Markup.button.callback('Approve', `treasury:approve:${r.id}`), Markup.button.callback('Reject', `treasury:reject:${r.id}`)]
          ])
        );
      } else {
        await ctx.reply(base);
      }
    }
  });

  // Команда-апрув: /approve <id> <2fa>
  bot.command('approve', async (ctx) => {
    const lang = await getLang(ctx);
    try {
      const [, id, code] = (ctx.message?.text || '').trim().split(/\s+/);
      if (!id) return ctx.reply('Формат: /approve <payout_id> <2fa_code>', menu(lang));
      if (REQ_CODE && code !== REQ_CODE) return ctx.reply('Неверный 2FA код.', menu(lang));

      const row = await db('outgoing_tx').where({ id }).first('*');
      if (!row || row.status !== 'queued') return ctx.reply('Задача не найдена или уже обработана.', menu(lang));

      // cap per-tx: 1:1 к USD (USDT/USDC)
      const amtUSD = Number(row.amount_usd || row.amount_token || 0);
      if (CAP > 0 && amtUSD > CAP) return ctx.reply(`Превышает CAP ${CAP} USD. Отклонено.`, menu(lang));

      await db('outgoing_tx').where({ id }).update({ status: 'approved' });
      await ctx.reply(`Approved: ${id}`, menu(lang));
    } catch {
      await ctx.reply('Ошибка approve.', menu(lang));
    }
  });

  // Команда-отклонение: /reject <id> <2fa>
  bot.command('reject', async (ctx) => {
    const lang = await getLang(ctx);
    try {
      const [, id, code] = (ctx.message?.text || '').trim().split(/\s+/);
      if (!id) return ctx.reply('Формат: /reject <payout_id> <2fa_code>', menu(lang));
      if (REQ_CODE && code !== REQ_CODE) return ctx.reply('Неверный 2FA код.', menu(lang));

      const row = await db('outgoing_tx').where({ id }).first('*');
      if (!row || row.status !== 'queued') return ctx.reply('Задача не найдена или уже обработана.', menu(lang));

      await db('outgoing_tx').where({ id }).update({ status: 'failed' }); // в MVP используем failed как cancel
      await ctx.reply(`Rejected: ${id}`, menu(lang));
    } catch {
      await ctx.reply('Ошибка reject.', menu(lang));
    }
  });

  // Инлайн-кнопки → подсказки с автоподстановкой команды
  bot.action(/treasury:approve:(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await ctx.reply(`/approve ${id} ${REQ_CODE ? '<2fa_code>' : ''}`);
  });
  bot.action(/treasury:reject:(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await ctx.reply(`/reject ${id} ${REQ_CODE ? '<2fa_code>' : ''}`);
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
    const [[{ c: in_total }], [{ c: in_conf }], [{ c: out_q }], [{ c: out_appr }], [{ c: out_c }]] = await Promise.all([
      db('incoming_tx').count('* as c'),
      db('incoming_tx').where({ status: 'confirmed' }).count('* as c'),
      db('outgoing_tx').where({ status: 'queued' }).count('* as c'),
      db('outgoing_tx').where({ status: 'approved' }).count('* as c'),
      db('outgoing_tx').where({ status: 'confirmed' }).count('* as c'),
    ]);
    await ctx.reply(`Incoming: total=${in_total} confirmed=${in_conf}\nPayouts: queued=${out_q} approved=${out_appr} confirmed=${out_c}`, menu(lang));
  });

  // inline навигация
  bot.action('treasury:payouts', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/payouts'));
  bot.action('treasury:incoming', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/incoming'));
  bot.action('treasury:stats', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/stats'));
  bot.action('treasury:lang:ru', async (ctx) => { await setLang(ctx, 'ru'); await ctx.answerCbQuery('RU'); await ctx.reply('Язык: RU', menu('ru')); });
  bot.action('treasury:lang:en', async (ctx) => { await setLang(ctx, 'en'); await ctx.answerCbQuery('EN'); await ctx.reply('Language: EN', menu('en')); });
};