# Cinema Reservation

Full-stack cinema seat reservation. Logged-in users view the seating map, select seats (held for 15 min), and complete a reservation.

Why it's built this way: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — decisions (§2), [trade-offs and what production would do instead (§8)](docs/ARCHITECTURE.md#8-trade-offs-ledger). Schema: [`docs/ERD.md`](docs/ERD.md).

## Prerequisites

- Docker with Compose v2
- Node 22 LTS (≥ 22.9) + npm — host-side seed and tests only
- Free ports: `5173` web · `3000` api · `5432` db · `5433` db-test

## Run

```sh
npm ci                        # host deps, for the seed script and tests
docker compose up --build -d  # db, db-test, api, web
npm run migrate               # usually a no-op: the api migrates on boot
npm run seed                  # users + 115 seats; idempotent, re-runnable
```

Open <http://localhost:5173>. Logins: `alice@example.com`, `bob@example.com`, `carol@example.com`, `dave@example.com`, `erin@example.com` — password `password` for all.

No `.env` needed: `.env.example` ships working dev values; a `.env`, if present, overrides it. Why migrate runs twice: [ARCHITECTURE §2 #24](docs/ARCHITECTURE.md#2-decisions).

Shortcut (after `npm ci`): `./dev.sh fresh` wipes the db volume, rebuilds, starts, waits for the api, and seeds. `./dev.sh` lists the other helpers.

## Test

```sh
docker compose up -d db-test  # already running if you did `docker compose up`
npm run check                 # typecheck + lint + tests
npm test                      # tests only
```

Integration tests run against `db-test` (`localhost:5433`, tmpfs) and migrate it themselves. They never touch the dev db.

## Stop

```sh
docker compose down           # keep data
docker compose down -v        # also wipe the db volume
```
