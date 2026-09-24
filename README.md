# Cinema Reservation

Full-stack cinema seat reservation. Logged-in users view the seating map, select seats (held for 15 min), and complete a reservation.

Why it's built this way: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — decisions (§2), [trade-offs and what production would do instead (§8)](docs/ARCHITECTURE.md#8-trade-offs-ledger). Schema: [`docs/ERD.md`](docs/ERD.md).

## Prerequisites

- Docker with Compose v2
- Node 22 LTS (≥ 22.9) + npm — tests and dev helpers only
- Free ports: `5173` web · `3000` api · `5432` db · `5433` db-test

## Run

```sh
docker compose up --build     # db, db-test, api, web; the api migrates and seeds on boot
```

Open <http://localhost:5173>. Logins: `alice@example.com`, `bob@example.com`, `carol@example.com`, `dave@example.com`, `erin@example.com` — password `password` for all.

No `.env` needed: `.env.example` ships working dev values; a `.env`, if present, overrides it. Host-side `npm run migrate` / `npm run seed` (after `npm ci`) exist for re-running by hand; both are idempotent.

Shortcut: `./dev.sh fresh` wipes the db volume, rebuilds, starts, and waits for the api. `./dev.sh` lists the other helpers.

## Test

```sh
npm ci                        # host deps
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
