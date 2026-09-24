# Architecture

Key design decisions. Setup is in the [README](../README.md); the schema is in [ERD.md](ERD.md). Code comments cite this file as `§N` or `§2 #N`.

## 1. Shape

npm-workspaces monorepo: `apps/api` (Express, run by `tsx`), `apps/web` (React + Vite), `packages/contracts` (Zod wire schemas), `packages/seat-rules` (pure seat-rule functions), `database/` (migrations, seeds).

Two backend modules, each owning its tables: **auth** and **cinema**. `cinema` holds both seats and reservations because every write touches both in one transaction. One seating map, no screenings.

## 2. Decisions

| # | Decision | Chosen | Because |
|---|---|---|---|
| 1 | Docs | This file (why), README (how to run), ERD (schema) | Each reader finds one thing in one place |
| 2 | ERD | Mermaid, generated from the migrations | Diffable; regenerated when migrations change |
| 3 | Framework | Express 5 + Zod | Readable without framework knowledge |
| 4 | DB access | Raw `pg` + SQL | The locking must be visible |
| 5 | Migrations | node-pg-migrate, SQL files | Real ledger; tests re-apply cleanly |
| 6 | Runtime | `tsx`, no build step | Same path in dev and Docker |
| 7 | Auth | JWT in an `httpOnly` cookie | JS can't read it; one origin (#9) keeps it simple |
| 8 | Users | Seeded only | Registration wasn't asked for |
| 9 | Compose | Vite proxies `/api` to the api | One origin: no CORS, cookie just works |
| 10 | Freshness | 5s polling | Postgres prevents double-booking; a stale map is cosmetic |
| 11 | Seat rules | Shared package, client + server | One implementation; client check is UX, server check is enforcement |
| 12 | Authorization | Services take an explicit `actor` | Testable without HTTP |
| 13 | Lint/format | Biome | One tool |
| 14 | Errors | One `AppError` + factories | Caught in one central handler |
| 15 | Logging | pino, correlation id per request | Traceable 5xx without leaking internals |
| 16 | Gap rule | Checks only what the selection changes | §5.2 |
| 17 | Hashing | `bcryptjs` | No native build in the image |
| 18 | Locking | Advisory locks per user and seat row | §3.1 |
| 19 | Lock waits | Bounded | §3.5 |
| 20 | Completing twice | Idempotent for the owner | §4 |
| 21 | "Which seats are mine?" | Client joins its own reservations onto the map | §10 |
| 22 | Naming | `reservation` on the wire, `holds` in the schema | §10 |
| 23 | Vocabulary | The §11 glossary binds code names, routes and UI text | One word per concept |
| 24 | Host scripts | Read `.env.example`/`.env`; `npm run migrate` waits on the migration lock | The seed never races the api's boot migration |
| 25 | Correlation id | `x-request-id` response header | Error body shape stays fixed |
| 26 | Auth token | HS256, 8h, cookie `SameSite=Strict`; bad token → `401` | Strict is free on one origin |
| 27 | Login timing | Unknown email still runs a bcrypt compare | No timing leak between unknown email and wrong password |
| 28 | Seed | `seed.ts`, idempotent; five users, password `password` | Re-runnable, no psql needed |
| 29 | Test DB | Tests migrate `db-test` themselves; each file creates its own users | Files run in parallel without sharing rows |
| 30 | Seat seed | `seedSeats()` shared by `npm run seed` and tests | One layout, migrations stay schema-only |
| 31 | Create while holding | `409 RESERVATION_ALREADY_HELD`; the same seats return the existing reservation | A retried create succeeds |
| 32 | Rule 1 / unknown seat | `400 BAD_REQUEST` | The request is wrong on its own |
| 33 | Pool timeout | Plain `500` | §3.5 |
| 34 | Lock-timeout log | Logged at `warn` by the error handler | Logging stays at the boundary |
| 35 | Holds in tests | One test file owns all hold writes and resets them | No stale holds between runs |
| 36 | Web | Plain CSS; no optimistic updates | Server is the only source of seat state |

## 3. Serializing writes within a seat row

A unique constraint stops two people taking the same seat, but not this:

> Row A is empty. Alice takes 1–2 and Bob takes 4–5 at the same time. Each is valid alone; together they isolate seat 3.

The gap rule depends on the whole row, so writes to a row must be serialized.

### 3.1 Mechanism

In one `READ COMMITTED` transaction:

1. `pg_advisory_xact_lock` on the user.
2. Advisory locks on each affected seat row, in ascending `row_number` order (no deadlocks).
3. `checked_at = clock_timestamp()`, taken after all locks.
4. Re-read state, reclaim expired holds, validate with `@cinema/seat-rules`, write, commit.

`unique(seat_id)` on claims stays as a backstop. Rejected: `FOR UPDATE` can't lock rows that don't exist yet; `SERIALIZABLE` needs a retry loop.

### 3.2 Transaction boundaries

Seats and reservations share a module (§1), so no transaction crosses modules.

### 3.3 Conflict response

Three `409` codes, one per remedy:

- `SEATS_UNAVAILABLE`: someone else got there first. Reselect. `details.seatIds` names directly taken seats.
- `RESERVATION_NOT_HELD`: your reservation expired, was cancelled or completed. Start again.
- `RESERVATION_ALREADY_HELD`: you already hold one. Change its seats instead.

Someone else's reservation is always `404`.

### 3.4 Writes covered

Create, replace, complete and cancel all use §3.1. A replace locks the old and new rows; on failure everything rolls back.

### 3.5 Bounded waits

`lock_timeout` 3s, `statement_timeout` 10s, pool acquire 5s. A lock or statement timeout becomes `SEATS_UNAVAILABLE`, logged at `warn`. A pool timeout stays `500`: the server is overloaded, not a seat taken.

## 4. Hold lifecycle

- **One hold per user**, enforced by a partial unique index.
- **Changing seats replaces them** and keeps the original 15-minute deadline. A timer that resets is an endless hold.
- **Expiry is lazy.** No background job: reads ignore expired holds, and writes reclaim them (mark `cancelled`, delete claims) under the row lock. `checked_at` is taken after locking, so a deadline that passes during a lock wait still counts.
- **Completion is idempotent** for the owner: a retry after a lost response returns the same reservation.
- **Cancel** releases only an owned, unexpired hold.

## 5. Gap rule edge cases

### 5.1 Single seats

Rule 2 applies to single-seat selections too: one seat can isolate its neighbour.

### 5.2 Existing gaps

A selection is valid if it creates no **new** isolated seat. Old gaps from expiry or cancellation are tolerated.

### 5.3 Row edges

No aisles, so an edge is a row's first or last seat.

### 5.4 Draft selections

The client disables **submit**, not seats. With seats 1 and 4 occupied, 2 alone and 3 alone are invalid but 2+3 is valid, so disabling seats would make it unreachable.

## 6. Data model

- `users`: seeded only.
- `seats`: 115 seeded seats, 10×10 + 3×5. `row_number` is the lock key.
- `holds`: `held` | `completed` | `cancelled`, `expires_at` set once. Reclamation writes `cancelled`.
- `seat_claims`: a row means the seat is occupied. Released claims are deleted.

Seat status is **derived**, never stored:

| Status | When |
|---|---|
| `booked` | a `completed` hold claims it |
| `reserved` | a `held`, unexpired hold claims it |
| `available` | otherwise |

## 7. Testing

- Unit: `@cinema/seat-rules`, table-driven.
- Integration, real Postgres: both races (§3) run as parallel transactions, plus expiry, replacement, ownership, cancel and completion.
- No frontend component tests: the logic lives in `seat-rules`.

## 8. Trade-offs ledger

Shortcut → what production would do:

- Row-level lock → per-seat locks under `SERIALIZABLE` once contention matters.
- Lazy expiry → plus a periodic cleanup sweep.
- 5s polling → SSE push.
- JWT not revocable, cookie not `Secure` → refresh tokens or sessions; HTTPS.
- No rate limiting → limits on login.
- No build step, Vite dev server in compose → compiled image; static build behind a CDN.
- No screenings → a `screenings` table in every query and lock key.
- No E2E test → Playwright for the two-user race.

## 9. Assumptions

Where the brief is open, this is how it was read:

- Rule 2 applies to single-seat selections too (§5.1).
- A row's edges are its first and last seats; there are no aisles (§5.3).
- Cancellation is supported, though the brief doesn't ask for it: otherwise released seats would wait out the 15 minutes.
- An expired reservation is stored as `cancelled`; nothing needs to tell the two apart (§6).

## 10. Wire surface

`/api` prefix. Success is the bare resource or `{ items }`; errors are `{ error: { code, message, details? } }`. All cinema routes need a login. Someone else's reservation is `404` on every `:id` route, so it never leaks.

| Route | Does |
|---|---|
| `GET /api/health` | DB round-trip |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | Login, logout, current user |
| `GET /api/seats` | Seating map with derived statuses |
| `GET /api/reservations` | Your own held + completed reservations |
| `POST /api/reservations` | Create (`201`) |
| `PUT /api/reservations/:id/seats` | Replace seats, keep deadline |
| `POST /api/reservations/:id/complete` | Complete (idempotent) |
| `DELETE /api/reservations/:id` | Cancel |

**The wire says `reservation`; the schema says `holds`.** The two names meet only in `cinema.repository`, where snake_case becomes camelCase.

**Which seats are mine:** `GET /api/seats` is the same for every viewer. The client marks its own seats by joining `GET /api/reservations`, so there are still exactly three seat statuses.

## 11. Glossary

`TASK.md`'s words win. Reservation statuses (`held`, `completed`, `cancelled`) and seat statuses (`available`, `reserved`, `booked`) never mix.

| Term | Means |
|---|---|
| reservation / hold | A user's claim on seats; `hold` is the schema word |
| complete | Make a held reservation permanent (never *confirm*) |
| cancel | Release a held reservation early |
| reclaim | Expire a reservation and release its seats during a later write |
| `checked_at` | The one timestamp a write decides by |
| occupied | Reserved or booked |
| isolated seat | One empty seat between occupied ones (Rule 2) |
| selection / draft | Seats a request asks for / seats being picked in the UI |
| claim | One `seat_claims` row |
| actor | The logged-in caller a service acts for |
