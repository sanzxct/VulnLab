'use strict';

// ---------------------------------------------------------------------------
// Schema + seed. Exports runSchema() and reseed() so the app can call them at
// boot, and runs as a CLI for the dedicated reset container:
//   node src/seed.js            -> run schema + reseed once, then exit
//   node src/seed.js --loop     -> reset shared seed data every RESET_INTERVAL
//
// Reset model (see spec §3):
//   * Shared/"victim" data (is_seed = TRUE) is restored to a known-good state.
//   * Seed users + products are UPSERTed in place (stable ids) so student carts
//     referencing them survive; their child data (orders, reviews) is wiped and
//     reinserted so stored-XSS / logic tampering / order edits self-heal.
//   * Student rows (is_seed = FALSE: their account, cart, own products/orders)
//     are never touched.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, waitForDb } = require('./db');
const config = require('./config');
const { FLAGS } = config;

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
const hash = (pw) => bcrypt.hashSync(pw, 8);

// ---- seed content ---------------------------------------------------------

const SEED_USERS = [
  { id: 1, username: 'alice', email: 'alice@bytebazaar.local', pw: 'spring2024',
    role: 'user', is_admin: false, full_name: 'Alice Nguyen',
    address: '42 Marina Blvd, Apt 5, San Francisco, CA 94123',
    bio: 'Coffee, code, and cats. Long-time ByteBazaar shopper.' },
  { id: 2, username: 'bob', email: 'bob@bytebazaar.local', pw: 'hunter2',
    role: 'seller', is_admin: false, full_name: 'Bob Marlow',
    address: '19 Baker Street, London, UK',
    bio: 'Refurbished gadgets and honest prices since 2019.' },
  { id: 3, username: 'carol', email: 'carol@bytebazaar.local', pw: 'caroline90',
    role: 'user', is_admin: false, full_name: 'Carol Danvers',
    address: '7 Oakwood Lane, Portland, OR 97201',
    bio: 'Just here for the vintage keyboards.' },
  { id: 4, username: 'dave', email: 'dave@bytebazaar.local', pw: 'davedave',
    role: 'seller', is_admin: false, full_name: 'Dave Okafor',
    address: '221 Industrial Way, Austin, TX 78701',
    bio: 'DaveTech — components, cables, and chaos.' },
  { id: 5, username: 'admin', email: 'admin@bytebazaar.local', pw: 'S3cureAdmin!2024',
    role: 'admin', is_admin: true, full_name: 'Site Administrator',
    address: 'ByteBazaar HQ',
    bio: 'ByteBazaar operations.' },
];

const SEED_PRODUCTS = [
  { id: 1,  seller_id: 2, name: 'Mechanical Keyboard "Clacker Pro"', price: 89.99,  category: 'peripherals', stock: 40,
    description: 'Hot-swappable switches, RGB, and a satisfying thock. Bob-certified refurbished.' },
  { id: 2,  seller_id: 2, name: 'Wireless Mouse Stealth-6', price: 34.50, category: 'peripherals', stock: 120,
    description: 'Silent clicks, 6 buttons, 70-hour battery.' },
  { id: 3,  seller_id: 4, name: 'USB-C Hub 8-in-1', price: 45.00, category: 'accessories', stock: 75,
    description: 'HDMI, ethernet, SD, and three USB-A ports. DaveTech reliable.' },
  { id: 4,  seller_id: 4, name: 'Braided USB-C Cable (2m)', price: 12.99, category: 'accessories', stock: 300,
    description: '100W PD, tangle-free, over-engineered.' },
  { id: 5,  seller_id: 2, name: '27" 4K Monitor "VistaSharp"', price: 329.00, category: 'displays', stock: 18,
    description: 'IPS panel, 99% sRGB, height-adjustable stand.' },
  { id: 6,  seller_id: 4, name: 'Noise-Cancelling Headphones Q30', price: 149.99, category: 'audio', stock: 55,
    description: 'ANC, 30-hour battery, plush ear cups.' },
  { id: 7,  seller_id: 5, name: 'ByteBazaar Gift Card $50', price: 50.00, category: 'gift-cards', stock: 999,
    description: 'Redeemable store credit. The perfect last-minute present.' },
  { id: 8,  seller_id: 2, name: 'Ergonomic Laptop Stand', price: 27.75, category: 'accessories', stock: 90,
    description: 'Aluminium, foldable, keeps your neck happy.' },
  { id: 9,  seller_id: 4, name: 'Webcam StreamCam 1080p', price: 59.90, category: 'peripherals', stock: 63,
    description: 'Auto-focus, dual mics, privacy shutter.' },
  { id: 10, seller_id: 2, name: 'Vintage Cherry Keycaps (set)', price: 41.00, category: 'peripherals', stock: 22,
    description: 'Double-shot PBT, retro beige. Very clacky.' },
  { id: 11, seller_id: 4, name: 'Portable SSD 1TB', price: 98.00, category: 'storage', stock: 47,
    description: 'USB 3.2 Gen2, 1050MB/s, pocket-sized.' },
  { id: 12, seller_id: 5, name: 'ByteBazaar Sticker Pack', price: 4.99, category: 'misc', stock: 999,
    description: 'Ten glossy hacker-camp stickers. Buy, sell, get hacked responsibly.' },
];

const SEED_REVIEWS = [
  { product_id: 1, user_id: 3, author_name: 'carol', rating: 5, body: 'Best keyboard I have ever owned. The thock is real.' },
  { product_id: 1, user_id: 1, author_name: 'alice', rating: 4, body: 'Great, but louder than my cat expected.' },
  { product_id: 5, user_id: 3, author_name: 'carol', rating: 5, body: 'Colours pop. Stand is rock solid.' },
  { product_id: 6, user_id: 1, author_name: 'alice', rating: 4, body: 'ANC is excellent on the train.' },
  { product_id: 3, user_id: 1, author_name: 'alice', rating: 5, body: 'One hub to rule them all.' },
];

// Orders carry PII-ish shipping fields. Order #1 (alice) hides the IDOR flag in
// its gift message so viewing another user's order has obvious impact (#6).
const SEED_ORDERS = [
  { id: 1, user_id: 1, status: 'delivered', ship_name: 'Alice Nguyen',
    ship_address: '42 Marina Blvd, Apt 5', ship_city: 'San Francisco', ship_country: 'USA',
    gift_message: `Happy birthday! Also, a note from the dev team: ${FLAGS.idor}`,
    coupon_code: 'WELCOME10',
    items: [ { product_id: 1, qty: 1 }, { product_id: 4, qty: 2 } ] },
  { id: 2, user_id: 1, status: 'shipped', ship_name: 'Alice Nguyen',
    ship_address: '42 Marina Blvd, Apt 5', ship_city: 'San Francisco', ship_country: 'USA',
    gift_message: '', coupon_code: '',
    items: [ { product_id: 6, qty: 1 } ] },
  { id: 3, user_id: 2, status: 'delivered', ship_name: 'Bob Marlow',
    ship_address: '19 Baker Street', ship_city: 'London', ship_country: 'UK',
    gift_message: 'For the workshop.', coupon_code: '',
    items: [ { product_id: 3, qty: 3 }, { product_id: 11, qty: 1 } ] },
  { id: 4, user_id: 3, status: 'placed', ship_name: 'Carol Danvers',
    ship_address: '7 Oakwood Lane', ship_city: 'Portland', ship_country: 'USA',
    gift_message: 'Please leave at the door.', coupon_code: 'SAVE25',
    items: [ { product_id: 10, qty: 2 }, { product_id: 1, qty: 1 } ] },
  { id: 5, user_id: 2, status: 'delivered', ship_name: 'Bob Marlow',
    ship_address: '19 Baker Street', ship_city: 'London', ship_country: 'UK',
    gift_message: '', coupon_code: '',
    items: [ { product_id: 5, qty: 1 } ] },
];

const SEED_COUPONS = [
  { code: 'WELCOME10', description: '10% off your first order', percent_off: 10, amount_off: 0 },
  { code: 'SAVE25',    description: '$25 off orders over $50',   percent_off: 0,  amount_off: 25 },
  { code: 'FREESHIP',  description: 'Free shipping (informational)', percent_off: 0, amount_off: 5 },
  { code: 'HALFOFF',   description: 'Seasonal 50% off blowout',  percent_off: 50, amount_off: 0 },
];

const SEED_SECRETS = [
  { name: 'ci_db_backup_note', secret_value: FLAGS.sqli },
  { name: 'internal_api_key',  secret_value: config.fakeInternalApiKey },
];

// ---- runners --------------------------------------------------------------

async function runSchema() {
  await pool.query(SCHEMA_SQL);
}

async function reseed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent reseeds (app boot vs. the reset tick vs. a manual
    // reset) so the fixed-id inserts can't race into unique-violations/deadlocks.
    await client.query('SELECT pg_advisory_xact_lock(727274)');

    // Wipe shared child/detail data (self-healing on every reset).
    await client.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE is_seed)');
    await client.query('DELETE FROM orders WHERE is_seed');
    // Remove ALL reviews on seed products (clears student stored-XSS payloads too).
    await client.query('DELETE FROM reviews WHERE product_id IN (SELECT id FROM products WHERE is_seed)');
    await client.query('DELETE FROM coupons WHERE is_seed');
    await client.query('DELETE FROM secrets WHERE is_seed');

    // Upsert seed users (stable ids; restores tampered passwords/profiles).
    // Each victim ships with a predictable, pending reset token (100000 + id)
    // so #10 is exploitable out of the box and self-heals on every reset.
    for (const u of SEED_USERS) {
      const resetToken = String(100000 + u.id);
      await client.query(
        `INSERT INTO users (id, username, email, password_hash, role, is_admin, bio, full_name, address, reset_token, reset_token_created, is_seed, member_since)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), TRUE, now() - interval '400 days')
         ON CONFLICT (id) DO UPDATE SET
           username=EXCLUDED.username, email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
           role=EXCLUDED.role, is_admin=EXCLUDED.is_admin, bio=EXCLUDED.bio,
           full_name=EXCLUDED.full_name, address=EXCLUDED.address, is_seed=TRUE,
           reset_token=EXCLUDED.reset_token, reset_token_created=now()`,
        [u.id, u.username, u.email, hash(u.pw), u.role, u.is_admin, u.bio, u.full_name, u.address, resetToken]
      );
    }

    // Upsert seed products (stable ids so student carts referencing them survive).
    for (const p of SEED_PRODUCTS) {
      await client.query(
        `INSERT INTO products (id, seller_id, name, description, price, category, stock, is_seed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         ON CONFLICT (id) DO UPDATE SET
           seller_id=EXCLUDED.seller_id, name=EXCLUDED.name, description=EXCLUDED.description,
           price=EXCLUDED.price, category=EXCLUDED.category, stock=EXCLUDED.stock, is_seed=TRUE`,
        [p.id, p.seller_id, p.name, p.description, p.price, p.category, p.stock]
      );
    }

    for (const r of SEED_REVIEWS) {
      await client.query(
        `INSERT INTO reviews (product_id, user_id, author_name, rating, body, is_seed)
         VALUES ($1,$2,$3,$4,$5,TRUE)`,
        [r.product_id, r.user_id, r.author_name, r.rating, r.body]
      );
    }

    for (const c of SEED_COUPONS) {
      await client.query(
        `INSERT INTO coupons (code, description, percent_off, amount_off, is_seed)
         VALUES ($1,$2,$3,$4,TRUE)`,
        [c.code, c.description, c.percent_off, c.amount_off]
      );
    }

    for (const s of SEED_SECRETS) {
      await client.query(
        `INSERT INTO secrets (name, secret_value, is_seed) VALUES ($1,$2,TRUE)`,
        [s.name, s.secret_value]
      );
    }

    // Seed orders with explicit ids + computed totals.
    for (const o of SEED_ORDERS) {
      let subtotal = 0;
      const itemRows = [];
      for (const it of o.items) {
        const p = SEED_PRODUCTS.find((x) => x.id === it.product_id);
        const line = Number(p.price) * it.qty;
        subtotal += line;
        itemRows.push({ product_id: p.id, name: p.name, qty: it.qty, price: p.price });
      }
      // Simple discount just so seed totals look believable.
      let discount = 0;
      if (o.coupon_code === 'WELCOME10') discount = subtotal * 0.10;
      if (o.coupon_code === 'SAVE25') discount = 25;
      const total = Math.max(0, subtotal - discount);
      await client.query(
        `INSERT INTO orders (id, user_id, status, subtotal, discount, total, coupon_code,
                             ship_name, ship_address, ship_city, ship_country, gift_message, is_seed,
                             created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE, now() - make_interval(days => $1))`,
        [o.id, o.user_id, o.status, subtotal.toFixed(2), discount.toFixed(2), total.toFixed(2),
         o.coupon_code, o.ship_name, o.ship_address, o.ship_city, o.ship_country, o.gift_message]
      );
      for (const ir of itemRows) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, quantity, price)
           VALUES ($1,$2,$3,$4,$5)`,
          [o.id, ir.product_id, ir.name, ir.qty, ir.price]
        );
      }
    }

    // Push all sequences above the seed id range so student-created rows never
    // collide with seed ids on the next reset. Students get ids >= 1001.
    for (const seq of ['users_id_seq', 'products_id_seq', 'orders_id_seq',
                       'reviews_id_seq', 'order_items_id_seq', 'secrets_id_seq']) {
      const tbl = seq.replace('_id_seq', '');
      await client.query(
        `SELECT setval('${seq}', GREATEST(1000, (SELECT COALESCE(MAX(id),0) FROM ${tbl})))`
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const loop = process.argv.includes('--loop');
  await waitForDb();
  await runSchema();
  if (!loop) {
    await reseed();
    console.log('[seed] one-shot reseed complete.');
    await pool.end();
    return;
  }
  console.log(`[reset] loop mode: reseeding shared data every ${Math.round(config.resetIntervalMs / 60000)} min.`);
  // Reseed once on start too, so `docker compose restart reset` acts as an
  // on-demand reset. The advisory lock in reseed() makes racing the app's
  // boot-time seed safe (they serialize).
  try {
    await reseed();
    console.log('[reset] initial reseed on start OK.');
  } catch (err) {
    console.error('[reset] initial reseed failed:', err.message);
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, config.resetIntervalMs));
    try {
      // Re-run schema every tick (CREATE TABLE IF NOT EXISTS is idempotent) so
      // ANY schema damage a student causes — e.g. `'; DROP TABLE orders; --`
      // via the intentional SQLi — self-heals within one reset interval. Per
      // spec §7: no destructive action may be un-resettable.
      await runSchema();
      await reseed();
      console.log(`[reset] shared seed data reset OK at interval.`);
    } catch (err) {
      console.error('[reset] reseed failed:', err.message);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed] fatal:', err);
    process.exit(1);
  });
}

module.exports = { runSchema, reseed };
