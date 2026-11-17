'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ---- home -----------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { rows: products } = await db.query(
      'SELECT id, name, price, category, image_url FROM products ORDER BY id LIMIT 24'
    );
    const { rows: cats } = await db.query(
      'SELECT DISTINCT category FROM products ORDER BY category'
    );
    res.render('home', {
      title: 'ByteBazaar — buy, sell, get hacked responsibly',
      products,
      categories: cats.map((c) => c.category),
    });
  } catch (err) {
    next(err);
  }
});

// ---- category browse ------------------------------------------------------
router.get('/category/:name', async (req, res, next) => {
  try {
    const { rows: products } = await db.query(
      'SELECT id, name, price, category, image_url FROM products WHERE category = $1 ORDER BY id',
      [req.params.name]
    );
    res.render('home', {
      title: `Category: ${req.params.name}`,
      products,
      categories: [],
      heading: `Category: ${req.params.name}`,
    });
  } catch (err) {
    next(err);
  }
});

// ---- search (#3 reflected XSS  +  #5 SQL injection) ------------------------
// The query string is concatenated straight into SQL (SQLi) AND reflected
// unescaped into the results page (reflected XSS). Two bugs, one input.
router.get('/search', async (req, res, next) => {
  const q = req.query.q != null ? String(req.query.q) : '';
  // Non-HttpOnly reward cookie: prove reflected XSS by reading it via script.
  // encode:identity so document.cookie shows the raw flag (not %7B…%7D).
  res.cookie('rxss_reward', config.FLAGS.reflected_xss, { httpOnly: false, sameSite: 'lax', encode: (v) => v });

  if (q === '') {
    return res.render('search', { title: 'Search', q, results: [], dbError: null, sql: null });
  }

  // !!! Intentionally vulnerable: raw string interpolation, no parameters. !!!
  // Runs in a READ ONLY transaction so UNION/error-based read exploitation
  // works but stacked writes/DDL can't destroy the shared environment.
  const sql =
    `SELECT id, name, price, description, image_url, category ` +
    `FROM products WHERE name ILIKE '%${q}%' OR description ILIKE '%${q}%' ORDER BY id`;
  try {
    const { rows: results } = await db.readonlyQuery(sql);
    res.render('search', { title: `Search: ${q}`, q, results, dbError: null, sql: null });
  } catch (err) {
    // Verbose DB error leaks the query -> enables error-based SQLi (#5).
    res.status(200).render('search', {
      title: `Search: ${q}`,
      q,
      results: [],
      dbError: err.message,
      sql,
    });
  }
});

// ---- product detail (#4 stored XSS in reviews) ----------------------------
router.get('/product/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { rows } = await db.query(
      `SELECT p.*, u.username AS seller_name
         FROM products p LEFT JOIN users u ON u.id = p.seller_id
        WHERE p.id = $1`,
      [id]
    );
    const product = rows[0];
    if (!product) return res.status(404).render('error', { title: 'Not found', message: 'No such product', stack: null });
    // Per-viewer review isolation (#4 lab stability, NOT a security control).
    // The stored-XSS payload is still stored raw and still rendered unescaped —
    // but with ~80 students hammering the same product, an unfiltered feed means
    // every page load fires every other student's alert(), which makes the
    // product page unusable for the whole room. So a student sees the shared
    // seed reviews plus their OWN reviews, and nobody else's. Anonymous viewers
    // (user_id IS NULL never matches) see only the seed reviews.
    const viewerId = req.user ? req.user.id : -1;
    const { rows: reviews } = await db.query(
      `SELECT id, author_name, rating, body, created_at
         FROM reviews
        WHERE product_id = $1
          AND (is_seed = TRUE OR user_id = $2)
        ORDER BY id DESC`,
      [id, viewerId]
    );
    // Non-HttpOnly reward cookie: prove stored XSS by reading it via script.
    res.cookie('sxss_reward', config.FLAGS.stored_xss, { httpOnly: false, sameSite: 'lax', encode: (v) => v });
    res.render('product', { title: product.name, product, reviews });
  } catch (err) {
    next(err);
  }
});

// ---- add review (stores raw HTML; rendered unescaped -> #4) ----------------
// Login required so every review has a user_id to scope it by — an anonymous
// review (user_id NULL) could never be shown back to whoever wrote it, so the
// author would post a payload and see nothing happen.
router.post('/product/:id/review', requireLogin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = String(req.body.body || '').slice(0, 4000);
    const rating = Math.max(1, Math.min(5, parseInt(req.body.rating || '5', 10) || 5));
    const author = req.user.username;
    if (body.trim()) {
      await db.query(
        `INSERT INTO reviews (product_id, user_id, author_name, rating, body, is_seed)
         VALUES ($1,$2,$3,$4,$5,FALSE)`,
        [id, req.user.id, author, rating, body]
      );
    }
    res.redirect('/product/' + encodeURIComponent(id) + '#reviews');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
