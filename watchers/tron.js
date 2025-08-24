import 'dotenv/config';
import { randomUUID } from 'crypto';
import { db } from '../api/db/pool.js';

const MOCK = String(process.env.MOCK_CHAIN || 'true') === 'true';
const TOKEN = (process.env.MOCK_TOKEN || 'USDT').toUpperCase();        // какой токен фейкать
const TICK_MS = Number(process.env.MOCK_INTERVAL_MS || 7000);          // как часто генерить входящие
const REQ_CONF = Number(process.env.MOCK_CONFIRMATIONS || 3);          // сколько «подтверждений»
const PASS_THROUGH = true;                                             // демо-логика: платить обратно отправителю

// Получаем id сети TRON и токена (USDT/USDC)
async function getIds() {
  const net = await db('network').where({ code: 'TRON' }).first('id');
  if (!net) throw new Error('В справочнике network нет записи с code=TRON');
  const tok = await db('token').where({ symbol: TOKEN }).first('id');
  if (!tok) throw new Error(`В справочнике token нет записи с symbol=${TOKEN}`);
  return { network_id: net.id, token_id: tok.id };
}

// Берём горячий кошелёк платформы (нужен для исходящих)
async function getHotWalletId(network_id, token_id) {
  const row = await db('platform_wallet')
    .where({ network_id, token_id, type: 'hot', is_active: true })
    .first('id');
  if (!row) {
    throw new Error(
      `[watcher-mock] нет горячего кошелька (platform_wallet) для token=${TOKEN}. ` +
      `Добавьте через SQL: адрес 'TMOCK_HOT_${TOKEN}'.`
    );
  }
  return row.id;
}

// Генерируем «фейковую» входящую транзакцию
async function createIncoming({ network_id, token_id }) {
  const tx_hash = `0x${randomUUID().replace(/-/g, '')}`;
  const from = 'TMOCK_FROM_' + tx_hash.slice(2, 8);
  const to = 'TMOCK_TO_' + tx_hash.slice(8, 14);
  const amount = '1.000000'; // 1 USDT/USDC

  await db('incoming_tx').insert({
    id: randomUUID(),
    network_id,
    token_id,
    tx_hash,
    from_address: from,
    to_address: to,
    amount_token: amount,
    amount_usd: null,
    confirmations: 0,
    status: 'seen',
    deal_id: null,
    deposit_id: null,
    created_at: db.fn.now(),
  });

  console.log(`[watcher-mock] incoming ${TOKEN} tx=${tx_hash} amount=${amount}`);
}

// Повышаем confirmation’ы и при достижении порога ставим выплату в очередь
async function bumpConfsAndQueue({ network_id, token_id }) {
  // берём последние «seen/confirmed» входящие этого токена/сети
  const rows = await db('incoming_tx')
    .where({ network_id, token_id })
    .whereIn('status', ['seen', 'confirmed'])
    .orderBy('created_at', 'desc')
    .limit(50);

  for (const r of rows) {
    // если ещё не добрали подтверждений — добавим +1
    if (r.status === 'seen' && (r.confirmations || 0) < REQ_CONF) {
      const next = (r.confirmations || 0) + 1;
      await db('incoming_tx').where({ id: r.id }).update({ confirmations: next });
      console.log(`[watcher-mock] +1 conf tx=${r.tx_hash} -> ${next}/${REQ_CONF}`);
    }

    const confs = Math.min(REQ_CONF, (r.confirmations || 0) + (r.status === 'seen' ? 1 : 0));
    if (confs >= REQ_CONF && r.status !== 'confirmed') {
      // помечаем входящую как подтверждённую
      await db('incoming_tx')
        .where({ id: r.id })
        .update({ status: 'confirmed', confirmations: REQ_CONF });

      // ставим исходящую выплату в очередь (idempotent по idempotency_key)
      if (PASS_THROUGH) {
        const from_wallet_id = await getHotWalletId(network_id, token_id);
        const idem = `pt:${r.tx_hash}`;
        try {
          await db('outgoing_tx').insert({
            id: randomUUID(),
            network_id,
            token_id,
            tx_hash: null,
            from_wallet_id,
            to_address: r.from_address,   // демо: отправить обратно отправителю
            amount_token: r.amount_token,
            amount_usd: null,
            status: 'queued',
            deal_id: r.deal_id || null,
            payout_request_id: null,
            eod_settlement_id: null,
            idempotency_key: idem,
            created_at: db.fn.now(),
          });
          console.log(`[watcher-mock] queued payout (idempotency=${idem})`);
        } catch (e) {
          // если уже ставили такую же задачу — тихо пропускаем
          if (!String(e.message).includes('uq_outgoing_idem')) throw e;
        }
      }
    }
  }
}

async function tick() {
  try {
    const ids = await getIds();
    await createIncoming(ids);        // новая входящая
    await bumpConfsAndQueue(ids);     // добираем подтверждения и ставим выплату
  } catch (e) {
    console.error('[watcher-mock] error:', e.message);
  } finally {
    setTimeout(tick, TICK_MS);
  }
}

if (!MOCK) {
  console.log('[watcher] MOCK_CHAIN=false — реальную интеграцию включим позже');
} else {
  console.log(`[watcher] MOCK_CHAIN=true — входящие ${TOKEN} каждые ${TICK_MS} мс, CONF=${REQ_CONF}`);
  tick();
}