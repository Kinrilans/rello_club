# Rello Club — MVP (local mock)

MVP для on/off-ramp (TRC-20, USDT/USDC) в mock-режиме: watcher входящих → очередь выплат → mock-движок выплат → боты.

## Быстрый старт
1) Установить зависимости: `npm i`
2) Скопировать `.env.example` → `.env` и задать `DATABASE_URL`
3) Запуск:
   - API: `npm run dev:api`  → http://localhost:8080/healthz, /metrics
   - Watcher (mock): `npm run dev:watcher`
   - Payout engine (mock): `npm run dev:engine`
   - Bots (если есть токены в `.env`): `npm run dev:bots`

## Структура
api/ # Express API (+ /metrics)
bots/ # @ClubGateBot, @DealDeskBot, @TreasuryBot
shared/ # i18n словари
watchers/ # tron.js (mock входящих)
scripts/ # payout_engine_mock.js (mock выплат)

## Документация (источник истины)
- product/mvp_plan_v1.md  
- tech/db_schema_v2.md  
- tech/webhooks_events_v1.md  
- tech/engine_payouts_v1.md  
(см. индекс RAW-ссылок: `dev_chat_howto_v1.md`)