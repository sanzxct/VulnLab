'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ---- seller dashboard -----------------------------------------------------
router.get('/seller', requireLogin, async (req, res, next) => {
  try {
    const { rows: products } = await db.query(
      'SELECT id, name, price, category, stock, image_url FROM products WHERE seller_id = $1 ORDER BY id DESC',
      [req.user.id]
    );
    // "Your own orders" — orders this seller placed.
    const { rows: orders } = await db.query(
      'SELECT id, status, total, created_at FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 20',
      [req.user.id]
    );
    res.render('seller', {
      title: 'Seller dashboard',
      products,
      orders,
      importResult: null,
    });
  } catch (err) {
    next(err);
  }
});

// ---- list a new product ---------------------------------------------------
router.post('/seller/products', requireLogin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 200);
    const description = String(req.body.description || '').slice(0, 4000);
    const price = Math.max(0, parseFloat(req.body.price) || 0);
    const category = String(req.body.category || 'misc').trim().slice(0, 60) || 'misc';
    const imageUrl = String(req.body.image_url || '/img/product-default.png').slice(0, 500);
    const stock = Math.max(0, parseInt(req.body.stock, 10) || 0);
    if (name) {
      await db.query(
        `INSERT INTO products (seller_id, name, description, price, category, image_url, stock, is_seed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)`,
        [req.user.id, name, description, price, category, imageUrl, stock]
      );
    }
    res.redirect('/seller');
  } catch (err) {
    next(err);
  }
});

// ---- import product image from URL (#8 SSRF) ------------------------------
// The server fetches whatever URL you give it, with NO allow-list / no scheme
// or host restriction, and reflects the response body back. Point it at
// http://internal.bytebazaar.local/secret to read an internal-only service.
router.post('/seller/import-image', requireLogin, async (req, res, next) => {
  const targetUrl = String(req.body.url || '').trim();
  let importResult = { url: targetUrl, ok: false, status: null, contentType: null, body: '', error: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(targetUrl, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    const text = await resp.text();
    importResult.ok = true;
    importResult.status = resp.status;
    importResult.contentType = resp.headers.get('content-type') || '';
    importResult.body = text.slice(0, 8000);
  } catch (err) {
    importResult.error = err.message || String(err);
  }

  try {
    const { rows: products } = await db.query(
      'SELECT id, name, price, category, stock, image_url FROM products WHERE seller_id = $1 ORDER BY id DESC',
      [req.user.id]
    );
    const { rows: orders } = await db.query(
      'SELECT id, status, total, created_at FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 20',
      [req.user.id]
    );
    res.render('seller', { title: 'Seller dashboard', products, orders, importResult });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
