import { db } from '../api/db/pool.js';
import { Telegraf, Markup } from 'telegraf';

export default (bot) => {
  bot.start((ctx) => ctx.reply('OpsAdmin: /health /queue /stuck /ack <text>'));

  bot.command('health', async (ctx) => {
    try { await db.raw('select 1'); await ctx.reply('DB: OK'); }
    catch (e) { await ctx.reply('DB: FAIL ' + e.message); }
  });

  bot.command('queue', async (ctx) => {
    const [[{ c_q }], [{ c_ap }], [{ c_br }], [{ c_cf }]] = await Promise.all([
      db('outgoing_tx').where({ status: 'queued' }).count('* as c_q'),
      db('outgoing_tx').where({ status: 'approved' }).count('* as c_ap'),
      db('outgoing_tx').where({ status: 'broadcast' }).count('* as c_br'),
      db('outgoing_tx').where({ status: 'confirmed' }).count('* as c_cf')
    ]);
    await ctx.reply(`payouts: queued=${c_q} approved=${c_ap} broadcast=${c_br} confirmed=${c_cf}`);
  });

  bot.command('stuck', async (ctx) => {
    const q = await db.raw(`select count(*)::int c from rello.outgoing_tx where status='queued' and created_at < now()-interval '15 minutes'`);
    const b = await db.raw(`select count(*)::int c from rello.outgoing_tx where status='broadcast' and created_at < now()-interval '30 minutes'`);
    await ctx.reply(`stuck: queued>${15}m=${q.rows[0].c}, broadcast>${30}m=${b.rows[0].c}`);
  });

  bot.command('ack', async (ctx) => {
    const text = (ctx.message?.text || '').split(' ').slice(1).join(' ') || 'ok';
    await ctx.reply('ACK: ' + text);
  });
};