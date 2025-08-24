import 'dotenv/config';
import express from 'express';
import { db } from './db/pool.js';

const app = express();

app.get('/healthz', async (_req, res) => {
  try { await db.raw('select 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/metrics', async (_req, res) => {
  try {
    const [{ c: in_total }] = await db('incoming_tx').count('* as c');
    const [{ c: in_confirmed }] = await db('incoming_tx').where({ status: 'confirmed' }).count('* as c');

    const [{ c: out_queued }] = await db('outgoing_tx').where({ status: 'queued' }).count('* as c');
    const [{ c: out_approved }] = await db('outgoing_tx').where({ status: 'approved' }).count('* as c').catch(() => [{ c: 0 }]);
    const [{ c: out_signed }] = await db('outgoing_tx').where({ status: 'signed' }).count('* as c');
    const [{ c: out_broadcast }] = await db('outgoing_tx').where({ status: 'broadcast' }).count('* as c');
    const [{ c: out_confirmed }] = await db('outgoing_tx').where({ status: 'confirmed' }).count('* as c');

    const body = [
      '# HELP rello_incoming_total Total incoming tx rows',
      '# TYPE rello_incoming_total counter',
      `rello_incoming_total ${in_total}`,
      '# HELP rello_incoming_confirmed_total Confirmed incoming tx rows',
      '# TYPE rello_incoming_confirmed_total counter',
      `rello_incoming_confirmed_total ${in_confirmed}`,
      '# HELP rello_outgoing_queue Number of queued payouts',
      '# TYPE rello_outgoing_queue gauge',
      `rello_outgoing_queue ${out_queued}`,
      '# HELP rello_outgoing_approved Number of approved payouts',
      '# TYPE rello_outgoing_approved gauge',
      `rello_outgoing_approved ${out_approved}`,
      '# HELP rello_outgoing_signed Number of signed payouts',
      '# TYPE rello_outgoing_signed gauge',
      `rello_outgoing_signed ${out_signed}`,
      '# HELP rello_outgoing_broadcast Number of broadcast payouts',
      '# TYPE rello_outgoing_broadcast gauge',
      `rello_outgoing_broadcast ${out_broadcast}`,
      '# HELP rello_outgoing_confirmed_total Confirmed payouts',
      '# TYPE rello_outgoing_confirmed_total counter',
      `rello_outgoing_confirmed_total ${out_confirmed}`,
    ].join('\n');

    res.type('text/plain').send(body);
  } catch (e) {
    res.status(500).type('text/plain').send(`# error\n${String(e)}`);
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`[api] up on :${port}`));