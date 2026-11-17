'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

async function getOrCreateCart(userId) {
  const { rows } = await db.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
  if (rows[0]) return rows[0];
  const ins = await db.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING *', [userId]);
  return ins.rows[0];
}

async function loadCartView(cart) {
  const { rows: items } = await db.query(
    `SELECT ci.product_id, ci.quantity, p.name, p.price, p.image_url
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1 ORDER BY ci.id`,
    [cart.id]
  );
  const subtotal = items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);

  // ---- #9 business logic flaw -------------------------------------------
  // Every applied coupon is honoured, EVERY time it appears in the list, with
  // no dedupe and no floor. Applying the same code repeatedly stacks the
  // discount without limit, so the total can be driven to zero or negative.
  const applied = Array.isArray(cart.applied_coupons) ? cart.applied_coupons : [];
  let discount = 0;
  const couponLines = [];
  for (const code of applied) {
    const { rows } = await db.query('SELECT * FROM coupons WHERE code = $1', [code]);
    const c = rows[0];
    if (!c) continue;
    const d = subtotal * (Number(c.percent_off) / 100) + Number(c.amount_off);
    discount += d;
    couponLines.push({ code: c.code, description: c.description, value: d });
  }
  const total = subtotal - discount; // deliberately NOT clamped to >= 0
  return { items, subtotal, discount, total, couponLines, applied };
}

// ---- view cart ------------------------------------------------------------
router.get('/cart', requireLogin, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    const view = await loadCartView(cart);
    res.render('cart', { title: 'Your cart', ...view, flash: req.query.msg || null });
  } catch (err) {
    next(err);
  }
});

// ---- add item -------------------------------------------------------------
router.post('/cart/add', requireLogin, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    const productId = parseInt(req.body.product_id, 10);
    let qty = parseInt(req.body.quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    const { rows } = await db.query('SELECT id FROM products WHERE id = $1', [productId]);
    if (!rows[0]) return res.redirect('/cart?msg=Product+not+found');
    await db.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1,$2,$3)
       ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
      [cart.id, productId, qty]
    );
    res.redirect('/cart?msg=Added+to+cart');
  } catch (err) {
    next(err);
  }
});

// ---- remove item ----------------------------------------------------------
router.post('/cart/remove', requireLogin, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    await db.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cart.id, parseInt(req.body.product_id, 10)]);
    res.redirect('/cart?msg=Removed');
  } catch (err) {
    next(err);
  }
});

// ---- apply coupon (#9: no dedupe -> stackable) ----------------------------
router.post('/cart/coupon', requireLogin, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.redirect('/cart?msg=Enter+a+code');
    const { rows } = await db.query('SELECT code FROM coupons WHERE code = $1', [code]);
    if (!rows[0]) return res.redirect('/cart?msg=Unknown+coupon+code');
    const applied = Array.isArray(cart.applied_coupons) ? cart.applied_coupons.slice() : [];
    applied.push(code); // duplicates intentionally allowed
    await db.query('UPDATE carts SET applied_coupons = $1 WHERE id = $2',
      [JSON.stringify(applied), cart.id]);
    res.redirect('/cart?msg=Coupon+applied');
  } catch (err) {
    next(err);
  }
});

router.post('/cart/coupon/clear', requireLogin, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    await db.query(`UPDATE carts SET applied_coupons = '[]' WHERE id = $1`, [cart.id]);
    res.redirect('/cart?msg=Coupons+cleared');
  } catch (err) {
    next(err);
  }
});

// ---- checkout (#9 reward when total drops to <= 0) ------------------------
router.post('/cart/checkout', requireLogin, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    const view = await loadCartView(cart);
    if (!view.items.length) return res.redirect('/cart?msg=Cart+is+empty');

    const shipName = String(req.body.ship_name || req.user.full_name || req.user.username);
    const shipAddress = String(req.body.ship_address || req.user.address || 'N/A');
    const shipCity = String(req.body.ship_city || '');
    const shipCountry = String(req.body.ship_country || '');
    const couponCode = view.applied.join(',');

    const { rows: orderRows } = await db.query(
      `INSERT INTO orders (user_id, status, subtotal, discount, total, coupon_code,
                           ship_name, ship_address, ship_city, ship_country, is_seed)
       VALUES ($1,'placed',$2,$3,$4,$5,$6,$7,$8,$9,FALSE) RETURNING id`,
      [req.user.id, view.subtotal.toFixed(2), view.discount.toFixed(2), view.total.toFixed(2),
       couponCode, shipName, shipAddress, shipCity, shipCountry]
    );
    const orderId = orderRows[0].id;
    for (const it of view.items) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, name, quantity, price)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, it.product_id, it.name, it.quantity, it.price]
      );
    }
    // Empty the cart + coupons.
    await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
    await db.query(`UPDATE carts SET applied_coupons = '[]' WHERE id = $1`, [cart.id]);

    const exploited = view.total <= 0;
    res.render('checkout', {
      title: 'Order placed',
      orderId,
      subtotal: view.subtotal,
      discount: view.discount,
      total: view.total,
      flag: exploited ? config.FLAGS.logic : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
