# ERD

Generated from `database/migrations/*.sql` — regenerate when a migration changes, never edit by memory. Why the tables look like this: [ARCHITECTURE §6](ARCHITECTURE.md#6-data-model).

```mermaid
erDiagram
    users ||--o{ holds : "user_id"
    holds ||--o{ seat_claims : "hold_id"
    seats ||--o| seat_claims : "seat_id (unique)"

    users {
        uuid id PK "default gen_random_uuid()"
        text email UK "not null"
        text password_hash "not null"
        timestamptz created_at "not null, default now()"
    }

    seats {
        uuid id PK "default gen_random_uuid()"
        int row_number "not null"
        text row_label "not null"
        int seat_number "not null"
    }

    holds {
        uuid id PK "default gen_random_uuid()"
        uuid user_id FK "not null -> users.id"
        text status "not null; held | completed | cancelled"
        timestamptz expires_at "not null"
        timestamptz created_at "not null, default now()"
    }

    seat_claims {
        uuid id PK "default gen_random_uuid()"
        uuid hold_id FK "not null -> holds.id"
        uuid seat_id FK,UK "not null -> seats.id; unique"
    }
```

Indexes and constraints not drawn above:

| Table | Name | Definition | Source |
|---|---|---|---|
| `holds` | `holds_one_held_per_user` | `UNIQUE (user_id) WHERE status = 'held'` — one active hold per user (ARCHITECTURE §4) | `1790208000000_cinema_create-seats-holds-seat-claims.sql` |
| `holds` | check | `status IN ('held', 'completed', 'cancelled')` | same |
| `seat_claims` | `seat_claims_hold_id` | `INDEX (hold_id)` | same |
| `seats` | unique | `UNIQUE (row_number, seat_number)` | same |

Ownership: `auth` owns `users`; `cinema` owns `seats`, `holds`, `seat_claims`.
