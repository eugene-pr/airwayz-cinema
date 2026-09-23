-- Up Migration
-- ARCHITECTURE §6. `seats` is seeded and immutable after seed; `row_number` is the
-- §3.1 lock key, so no migration may ever renumber it.
CREATE TABLE seats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_number  int  NOT NULL,
  row_label   text NOT NULL,
  seat_number int  NOT NULL,
  UNIQUE (row_number, seat_number)
);

-- The wire says reservation; the schema says hold (§10).
CREATE TABLE holds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  status     text NOT NULL CHECK (status IN ('held', 'completed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One active hold per user (§4). Includes expired holds until reclaimed.
CREATE UNIQUE INDEX holds_one_held_per_user ON holds (user_id) WHERE status = 'held';

-- A claim's existence is the fact of occupancy; released claims are deleted (§6).
CREATE TABLE seat_claims (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL REFERENCES holds(id),
  seat_id uuid NOT NULL UNIQUE REFERENCES seats(id)
);
CREATE INDEX seat_claims_hold_id ON seat_claims (hold_id);

-- Down Migration
DROP TABLE seat_claims;
DROP TABLE holds;
DROP TABLE seats;
