'use strict';

const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ---- my orders ------------------------------------------------------------
router.get('/orders', requireLogin, async (req, res, next) => {
  try {
    const { rows: orders } = await db.query(
      `SELECT id, status, total, coupon_code, created_at
         FROM orders WHERE user_id = $1 ORDER BY id DESC`,
      [req.user.id]
    );
    res.render('orders', { title: 'My orders', orders });
  } catch (err) {
    next(err);
  }
});

// ---- order detail (WEB page enforces ownership; the API does not => #6) ----
router.get('/orders/:id', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).render('error', { title: 'Not found', message: 'No such order', stack: null });
    if (order.user_id !== req.user.id) {
      // The UI blocks cross-user access... but /api/orders/:id forgot to (#6).
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'This is not your order. (Tip: the JSON API behind this page may be less careful...)',
        stack: null,
      });
    }
    const { rows: items } = await db.query(
      'SELECT name, quantity, price FROM order_items WHERE order_id = $1 ORDER BY id',
      [order.id]
    );
    res.render('order_detail', { title: `Order #${order.id}`, order, items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
