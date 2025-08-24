// bots/deal.js
import { db } from '../api/db/pool.js';
import { ensureIdentity, getIds, getLang, setLang, t, parsePositiveAmount } from './helpers.js';
import { Markup } from 'telegraf';

function menu(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'menu.feed'), 'deal:feed'), Markup.button.callback(t(lang, 'menu.offers'), 'deal:offers')],
    [Markup.button.callback(t(lang, 'menu.my_deals'), 'deal:my_deals')],
    [Markup.button.callback(t(lang, 'menu.lang_ru'), 'deal:lang:ru'), Markup.button.callback(t(lang, 'menu.lang_en'), 'deal:lang:en')]
  ]);
}

export default (bot) => {
  bot.start(async (ctx) => {
    const lang = await getLang(ctx);
    await ensureIdentity(ctx);
    await ctx.reply(`*${t(lang, 'deal.start_title')}*\n${t(lang, 'deal.start_hint')}`, {
      parse_mode: 'Markdown',
      ...menu(lang)
    });
  });

  bot.command('lang', async (ctx) => {
    const arg = (ctx.message?.text || '').split(/\s+/)[1];
    await setLang(ctx, arg === 'en' ? 'en' : 'ru');
    const lang = await getLang(ctx);
    await ctx.reply(t(lang, 'common.lang_set'), menu(lang));
  });

  bot.command('offers', async (ctx) => {
    const lang = await getLang(ctx);
    const { company } = await ensureIdentity(ctx);
    const rows = await db('offer').where({ company_id: company.id }).orderBy('created_at', 'desc').limit(10);
    if (!rows.length) return ctx.reply(t(lang, 'deal.offers_empty'), menu(lang));
    const lines = rows.map((o, i) => `${i + 1}. ${o.id} • ${o.direction} • ${o.status} • amount=${o.amount_min || '-'}..${o.amount_max || '-'}`).join('\n');
    await ctx.reply(lines, menu(lang));
  });

  // Лента активных офферов НЕ моей компании + кнопки Accept
  bot.command('feed', async (ctx) => {
    const lang = await getLang(ctx);
    const { company } = await ensureIdentity(ctx);
    const { network_id, token_id } = await getIds();

    const rows = await db('offer')
      .where({ status: 'active', network_id, token_id })
      .andWhereNot({ company_id: company.id })
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('*');

    if (!rows.length) return ctx.reply(t(lang, 'deal.feed_empty'), menu(lang));

    for (const o of rows) {
      await ctx.reply(
        `ID: ${o.id}\n${o.direction} • amount=${o.amount_min || '-'} • price=1`,
        Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'deal.accept_btn'), `deal:accept:${o.id}`)]])
      );
    }
  });

  // Создание оффера: /offer_new <in|out> <amount>
  bot.command('offer_new', async (ctx) => {
    const lang = await getLang(ctx);
    try {
      const parts = (ctx.message?.text || '').split(/\s+/);
      const dir = (parts[1] || '').toLowerCase();
      const amount = parsePositiveAmount(parts[2]);
      if (!['in', 'out'].includes(dir)) return ctx.reply(t(lang, 'deal.offer_bad_args'), menu(lang));
      if (!amount) return ctx.reply(t(lang, 'deal.offer_bad_amount'), menu(lang));

      const { company } = await ensureIdentity(ctx);
      const { network_id, token_id } = await getIds();
      const direction = dir === 'in' ? 'cash_in' : 'cash_out';

      const inserted = await db('offer').insert({
        id: db.raw('gen_random_uuid()'),
        company_id: company.id,
        direction,
        mode: 'pass_through',
        network_id,
        token_id,
        fiat_currency: 'USD',
        amount_min: amount,
        amount_max: amount,
        price_type: 'fixed',
        price_value: 1,
        status: 'active',
        created_at: db.fn.now(),
      }).returning(['id']);

      await ctx.reply(t(lang, 'deal.offer_created', { id: inserted[0].id }), menu(lang));
    } catch {
      await ctx.reply(t(await getLang(ctx), 'common.error'), menu(await getLang(ctx)));
    }
  });

  // Принять оффер: /offer_accept <id>
  bot.command('offer_accept', async (ctx) => {
    const lang = await getLang(ctx);
    try {
      const offerId = (ctx.message?.text || '').split(/\s+/)[1];
      const dealId = await acceptOffer(ctx, offerId);
      if (!dealId) return; // сообщение уже отправлено
      await ctx.reply(t(lang, 'deal.deal_created', { id: dealId }), menu(lang));
    } catch {
      await ctx.reply(t(await getLang(ctx), 'common.error'), menu(await getLang(ctx)));
    }
  });

  // inline Accept
  bot.action(/deal:accept:(.+)/, async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.answerCbQuery();
    const offerId = ctx.match[1];
    try {
      const dealId = await acceptOffer(ctx, offerId);
      if (dealId) await ctx.reply(t(lang, 'deal.accepted', { id: dealId }), menu(lang));
    } catch {
      await ctx.reply(t(await getLang(ctx), 'common.error'), menu(await getLang(ctx)));
    }
  });

  bot.command('my_deals', async (ctx) => {
    const lang = await getLang(ctx);
    const { company } = await ensureIdentity(ctx);
    const rows = await db('deal')
      .where(builder => builder.where({ initiator_company_id: company.id }).orWhere({ counterparty_company_id: company.id }))
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('id', 'state', 'direction', 'amount_token', 'created_at');

    if (!rows.length) return ctx.reply('Сделок пока нет.', menu(lang));
    const lines = rows.map((d, i) => `${i + 1}. ${d.id} • ${d.state} • ${d.direction} • amount=${d.amount_token || '-'}`).join('\n');
    await ctx.reply(lines, menu(lang));
  });

  bot.action('deal:feed', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/feed'));
  bot.action('deal:offers', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/offers'));
  bot.action('deal:my_deals', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/my_deals'));
  bot.action('deal:lang:ru', async (ctx) => { await setLang(ctx, 'ru'); await ctx.answerCbQuery('RU'); await ctx.reply('Язык: RU', menu('ru')); });
  bot.action('deal:lang:en', async (ctx) => { await setLang(ctx, 'en'); await ctx.answerCbQuery('EN'); await ctx.reply('Language: EN', menu('en')); });
};

// --- helpers ---
async function acceptOffer(ctx, offerId) {
  const lang = await getLang(ctx);
  if (!offerId) { await ctx.reply(t(lang, 'deal.offer_not_found')); return null; }

  const offer = await db('offer').where({ id: offerId, status: 'active' }).first('*');
  if (!offer) { await ctx.reply(t(lang, 'deal.offer_not_found')); return null; }

  const { company, member } = await ensureIdentity(ctx);
  if (company.id === offer.company_id) { await ctx.reply(t(lang, 'deal.offer_own')); return null; }

  const dealId = (await db('deal').insert({
    id: db.raw('gen_random_uuid()'),
    offer_id: offer.id,
    initiator_company_id: offer.company_id,
    counterparty_company_id: company.id,
    direction: offer.direction,
    mode: offer.mode,
    network_id: offer.network_id,
    token_id: offer.token_id,
    fiat_currency: offer.fiat_currency,
    amount_token: offer.amount_min,
    amount_usd: null,
    rate_fiat_per_token: offer.price_value,
    deadline_at: null,
    state: 'proposed',
    is_trusted_netting: false,
    trust_session_id: null,
    created_by_member_id: member.id,
    created_at: db.fn.now(),
    closed_at: null
  }).returning('id'))[0].id;

  await db('offer').where({ id: offer.id }).update({ status: 'closed' });
  return dealId;
}