-- Up Migration
-- ARCHITECTURE §6. Seeded only (§2 #8): no path writes here besides the seed.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE users;
