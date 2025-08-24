import 'dotenv/config';
import { Telegraf } from 'telegraf';
import club from './club.js';
import deal from './deal.js';
import treasury from './treasury.js';
import arbiter from './arbiter.js';
import ops from './ops.js';

function maybeStart(token, name, init) {
  if (!token) { console.log(`[bots] ${name}: TOKEN not set — skipped`); return; }
  const bot = new Telegraf(token);
  init(bot);
  bot.launch();
  console.log(`[bots] ${name} launched`);
}

maybeStart(process.env.TG_CLUB_BOT_TOKEN, 'ClubGateBot', club);
maybeStart(process.env.TG_DEAL_BOT_TOKEN, 'DealDeskBot', deal);
maybeStart(process.env.TG_TREASURY_BOT_TOKEN, 'TreasuryBot', treasury);
maybeStart(process.env.TG_ARBITER_BOT_TOKEN, 'ArbiterDeskBot', arbiter);
maybeStart(process.env.TG_OPS_BOT_TOKEN, 'OpsAdminBot', ops);

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));