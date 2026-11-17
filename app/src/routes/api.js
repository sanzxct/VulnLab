'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ---- #2 client-side trust -------------------------------------------------
// /api/me returns role/isAdmin AND a "hidden_admin_flag" field. The frontend
// (public/js/app.js) trusts isAdmin to decide whether to reveal the admin
// teaser + that flag. Tampering the JSON response client-side (flip isAdmin to
// true) unlocks the UI element — the flag was in the response the whole time.
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    role: req.user.role,
    isAdmin: req.user.is_admin,       // frontend trusts this
    member_since: req.user.member_since,
    // Sent to everyone; UI is *supposed* to only show it to admins.
    hidden_admin_flag: config.FLAGS.clientside,
  });
});

// ---- public product API ---------------------------------------------------
router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, price, category, image_url, stock FROM products ORDER BY id'
    );
    res.json({ products: rows });
  } catch (err) { next(err); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---- #6 IDOR --------------------------------------------------------------
// Any logged-in user can read ANY order by sequential numeric id. No ownership
// check. Leaks PII-ish shipping fields + the gift message (which hides the
// IDOR flag on seed order #1).
router.get('/orders/:id', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'not_found' });
    const { rows: items } = await db.query(
      'SELECT name, quantity, price FROM order_items WHERE order_id = $1 ORDER BY id',
      [order.id]
    );
    res.json({
      id: order.id,
      user_id: order.user_id,
      status: order.status,
      subtotal: order.subtotal,
      discount: order.discount,
      total: order.total,
      coupon_code: order.coupon_code,
      shipping: {
        name: order.ship_name,
        address: order.ship_address,
        city: order.ship_city,
        country: order.ship_country,
      },
      gift_message: order.gift_message,
      created_at: order.created_at,
      items,
    });
  } catch (err) { next(err); }
});

// ---- #12 hidden bonus: BFLA (cancel ANY order) ----------------------------
// Undocumented endpoint. Any logged-in user can cancel any order — including
// other *students'* orders, not just seed accounts. Kept back for session 3.
router.post('/orders/:id/cancel', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id, user_id, status FROM orders WHERE id = $1', [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'not_found' });
    await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [order.id]);
    const stolen = order.user_id !== req.user.id;
    res.json({
      ok: true,
      order_id: order.id,
      new_status: 'cancelled',
      owner_user_id: order.user_id,
      cancelled_by_user_id: req.user.id,
      note: stolen
        ? 'You cancelled an order that does not belong to you.'
        : 'You cancelled your own order.',
      flag: stolen ? config.FLAGS.bonus : undefined,
    });
  } catch (err) { next(err); }
});

// ---- #7 broken access control (JSON twin of /admin) -----------------------
// Undocumented, no role check. Reachable from any (or no) session.
router.get('/admin/stats', async (req, res, next) => {
  try {
    const [{ rows: u }, { rows: p }, { rows: o }, { rows: rev }] = await Promise.all([
      db.query('SELECT count(*)::int AS n FROM users'),
      db.query('SELECT count(*)::int AS n FROM products'),
      db.query('SELECT count(*)::int AS n FROM orders'),
      db.query('SELECT COALESCE(sum(total),0)::numeric AS s FROM orders'),
    ]);
    res.json({
      users: u[0].n,
      products: p[0].n,
      orders: o[0].n,
      revenue: Number(rev[0].s),
      flag: config.FLAGS.bac,
    });
  } catch (err) { next(err); }
});

// ---- api docs page --------------------------------------------------------
router.get('/docs', (req, res) => {
  res.render('docs', { title: 'API docs' });
});

module.exports = router;
