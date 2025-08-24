// bots/arbiter.js — базовый арбитраж (минимум)
import { db } from '../api/db/pool.js';

export default (bot) => {
  bot.start((ctx) => ctx.reply('Arbiter: /disputes, /open <deal_id> <against_company_slug> <reason>, /resolve <dispute_id> <refund|penalty|split|reject> <amount>'));

  bot.command('disputes', async (ctx) => {
    const rows = await db('dispute').orderBy('created_at','desc').limit(10).select('*');
    if (!rows.length) return ctx.reply('Споров нет.');
    const lines = rows.map(d => `${d.id} • ${d.status} • type=${d.type} • deal=${d.deal_id || '-'}`);
    await ctx.reply(lines.join('\n'));
  });

  bot.command('open', async (ctx) => {
    const [, dealId, againstSlug, ...reasonParts] = (ctx.message?.text || '').trim().split(/\s+/);
    const reason = reasonParts.join(' ') || 'n/a';
    if (!dealId || !againstSlug) return ctx.reply('Формат: /open <deal_id> <against_company_slug> <reason>');

    const deal = await db('deal').where({ id: dealId }).first('*');
    if (!deal) return ctx.reply('Сделка не найдена.');

    const against = await db('company').where({ slug: againstSlug }).first('*');
    if (!against) return ctx.reply('Компания не найдена.');

    const openedBy = deal.initiator_company_id === against.id ? deal.counterparty_company_id : deal.initiator_company_id;

    const id = (await db('dispute').insert({
      id: db.raw('gen_random_uuid()'),
      deal_id: dealId,
      trust_session_id: null,
      opened_by_company_id: openedBy,
      against_company_id: against.id,
      status: 'open',
      type: 'deal',
      reason_code: 'manual',
      claim_text: reason,
      created_at: db.fn.now(),
    }).returning('id'))[0].id;

    await ctx.reply(`Спор открыт: ${id}`);
  });

  bot.command('resolve', async (ctx) => {
    const [, dispId, decision, amountStr] = (ctx.message?.text || '').trim().split(/\s+/);
    if (!dispId || !decision) return ctx.reply('Формат: /resolve <dispute_id> <refund|penalty|split|reject> <amount?>');

    const dispute = await db('dispute').where({ id: dispId }).first('*');
    if (!dispute) return ctx.reply('Спор не найден.');

    const amount = amountStr ? amountStr : null;

    const decId = (await db('dispute_decision').insert({
      id: db.raw('gen_random_uuid()'),
      dispute_id: dispId,
      decision,
      amount_token: amount,
      amount_usd: amount,
      beneficiary_company_id: dispute.opened_by_company_id,
      rationale_text: 'mock decision',
      decided_by_member_id: db.raw('(SELECT id FROM member ORDER BY created_at LIMIT 1)'),
      created_at: db.fn.now(),
    }).returning('id'))[0].id;

    await db('dispute').where({ id: dispId }).update({ status: 'resolved', resolved_at: db.fn.now() });

    await ctx.reply(`Решение сохранено: ${decId}`);
  });
};