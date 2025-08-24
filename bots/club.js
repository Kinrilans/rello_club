import { db } from '../api/db/pool.js';
import { ensureIdentity, getIds, getLang, setLang, t, isValidTronAddress } from './helpers.js';
import { Markup } from 'telegraf';

function clubMenu(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'menu.profile'), 'club:profile')],
    [Markup.button.callback(t(lang, 'menu.wallets'), 'club:wallets'), Markup.button.callback(t(lang, 'menu.wallet_add'), 'club:wallet_add_hint')],
    [Markup.button.callback(t(lang, 'menu.trust_request'), 'club:trust_hint')],
    [Markup.button.callback(t(lang, 'menu.lang_ru'), 'club:lang:ru'), Markup.button.callback(t(lang, 'menu.lang_en'), 'club:lang:en')]
  ]);
}

export default (bot) => {
  bot.start(async (ctx) => {
    const lang = await getLang(ctx);
    await ensureIdentity(ctx);
    await ctx.reply(`*${t(lang, 'club.start_title')}*\n${t(lang, 'club.start_hint')}`, {
      parse_mode: 'Markdown',
      ...clubMenu(lang)
    });
  });

  bot.command('lang', async (ctx) => {
    const arg = (ctx.message?.text || '').split(/\s+/)[1];
    await setLang(ctx, arg === 'en' ? 'en' : 'ru');
    const lang = await getLang(ctx);
    await ctx.reply(t(lang, 'common.lang_set'), clubMenu(lang));
  });

  bot.command('profile', async (ctx) => {
    const lang = await getLang(ctx);
    const { company } = await ensureIdentity(ctx);
    await ctx.reply(t(lang, 'club.profile', {
      name: company.name, slug: company.slug, status: company.status, tz: company.timezone
    }), clubMenu(lang));
  });

  bot.command('wallets', async (ctx) => {
    const lang = await getLang(ctx);
    const { company } = await ensureIdentity(ctx);
    const rows = await db('address_allowlist').where({ company_id: company.id }).orderBy('created_at', 'desc').limit(10);
    if (!rows.length) return ctx.reply(t(lang, 'club.wallets_empty'), clubMenu(lang));
    const list = rows.map((w, i) => `${i + 1}. ${w.address} (${w.label || 'no label'})`).join('\n');
    await ctx.reply(`${t(lang, 'club.wallets_list_title')}\n${list}`, clubMenu(lang));
  });

  bot.command('wallet_add', async (ctx) => {
    const lang = await getLang(ctx);
    try {
      const addr = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();
      if (!isValidTronAddress(addr)) return ctx.reply(t(lang, 'club.wallet_add_bad'), clubMenu(lang));
      const { company } = await ensureIdentity(ctx);
      const { network_id, token_id } = await getIds();

      await db('address_allowlist').insert({
        id: db.raw('gen_random_uuid()'),
        company_id: company.id,
        network_id,
        token_id,
        address: addr,
        label: 'added_via_bot',
        created_at: db.fn.now(),
      });

      await ctx.reply(t(lang, 'club.wallet_add_ok'), clubMenu(lang));
    } catch {
      await ctx.reply(t(await getLang(ctx), 'common.error'), clubMenu(await getLang(ctx)));
    }
  });

  bot.command('trust_request', async (ctx) => {
    const lang = await getLang(ctx);
    try {
      const partnerSlug = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();
      if (!partnerSlug) return ctx.reply(t(lang, 'club.partner_not_found'), clubMenu(lang));

      const { company, member } = await ensureIdentity(ctx);
      const partner = await db('company').where({ slug: partnerSlug }).first('id');
      if (!partner) return ctx.reply(t(lang, 'club.partner_not_found'), clubMenu(lang));

      const lowId = company.id < partner.id ? company.id : partner.id;
      const highId = company.id < partner.id ? partner.id : company.id;

      await db('trust_pair').insert({
        id: db.raw('gen_random_uuid()'),
        company_a_id: company.id,
        company_b_id: partner.id,
        company_low_id: lowId,
        company_high_id: highId,
        status: 'proposed',
        tokens: ['USDT'],
        networks: ['TRC20'],
        daily_credit_limit_usd: null,
        reserve_pct: null,
        cutoff_local_time: null,
        timezone: 'Europe/Warsaw',
        created_by: member.id,
        created_at: db.fn.now(),
      });

      await ctx.reply(t(lang, 'club.trust_requested'), clubMenu(lang));
    } catch (e) {
      if (String(e.message).includes('uq_trust_pair')) {
        return ctx.reply(t(await getLang(ctx), 'club.trust_exists'), clubMenu(await getLang(ctx)));
      }
      await ctx.reply(t(await getLang(ctx), 'common.error'), clubMenu(await getLang(ctx)));
    }
  });

  // --- inline buttons handlers ---
  bot.action('club:profile', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/profile'));
  bot.action('club:wallets', (ctx) => ctx.telegram.sendMessage(ctx.chat.id, '/wallets'));
  bot.action('club:wallet_add_hint', async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.answerCbQuery();
    await ctx.reply(`${t(lang, 'club.start_hint')}\n\n/wallet_add T...`);
  });
  bot.action('club:trust_hint', async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.answerCbQuery();
    await ctx.reply(`${t(lang, 'club.start_hint')}\n\n/trust_request partner-slug`);
  });
  bot.action('club:lang:ru', async (ctx) => { await setLang(ctx, 'ru'); await ctx.answerCbQuery('RU'); await ctx.reply(t('ru', 'common.lang_set')); });
  bot.action('club:lang:en', async (ctx) => { await setLang(ctx, 'en'); await ctx.answerCbQuery('EN'); await ctx.reply(t('en', 'common.lang_set')); });
};