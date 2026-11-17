-- ByteBazaar schema. Idempotent: safe to run at every boot.
-- Shared/seed rows are marked is_seed = TRUE and are wiped + reinserted by the
-- periodic reset job. Student-created rows (is_seed = FALSE) survive resets.

-- Self-heal even a `DROP SCHEMA public CASCADE` (the read-only search tx should
-- already block it, but the reset re-runs this every tick as a backstop).
CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'seller' | 'admin'
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  bio           TEXT DEFAULT '',
  avatar_url    TEXT DEFAULT '/img/avatar-default.svg',
  full_name     TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  reset_token   TEXT,                              -- #10: predictable, non-expiring
  reset_token_created TIMESTAMPTZ,
  is_seed       BOOLEAN NOT NULL DEFAULT FALSE,
  member_since  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  seller_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  price        NUMERIC(10,2) NOT NULL DEFAULT 0,
  category     TEXT DEFAULT 'misc',
  image_url    TEXT DEFAULT '/img/product-default.svg',
  stock        INTEGER NOT NULL DEFAULT 100,
  is_seed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id           SERIAL PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name  TEXT DEFAULT 'anonymous',
  rating       INTEGER NOT NULL DEFAULT 5,
  body         TEXT NOT NULL,                      -- #4: rendered unescaped
  is_seed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'placed',     -- placed | shipped | delivered | cancelled
  subtotal     NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total        NUMERIC(10,2) NOT NULL DEFAULT 0,
  coupon_code  TEXT DEFAULT '',
  ship_name    TEXT DEFAULT '',                    -- #6: PII-ish fields
  ship_address TEXT DEFAULT '',
  ship_city    TEXT DEFAULT '',
  ship_country TEXT DEFAULT '',
  gift_message TEXT DEFAULT '',
  is_seed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  price        NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS carts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- Applied coupons are appended here as a JSON array of codes. Duplicates are
  -- allowed on purpose (#9 coupon stacking).
  applied_coupons JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id           SERIAL PRIMARY KEY,
  cart_id      INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS coupons (
  code         TEXT PRIMARY KEY,
  description  TEXT DEFAULT '',
  percent_off  INTEGER NOT NULL DEFAULT 0,
  amount_off   NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_seed      BOOLEAN NOT NULL DEFAULT FALSE
);

-- SQLi (#5) exfiltration target: a table students should NOT be able to read,
-- but the raw-string search query lets them UNION SELECT out of it.
CREATE TABLE IF NOT EXISTS secrets (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  secret_value TEXT NOT NULL,
  is_seed      BOOLEAN NOT NULL DEFAULT FALSE
);
