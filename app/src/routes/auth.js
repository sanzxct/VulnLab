'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');

const router = express.Router();

// Predictable, sequential reset token derived purely from the user id (#10).
function tokenForUser(id) {
  return String(100000 + Number(id));
}

// ---- register -------------------------------------------------------------
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Sign up', error: null });
});

router.post('/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !email || password.length < 4) {
      return res.status(400).render('register', { title: 'Sign up', error: 'Username, email, and a 4+ char password are required.' });
    }
    const hash = bcrypt.hashSync(password, 8);
    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO users (username, email, password_hash, role, is_seed)
         VALUES ($1,$2,$3,'user',FALSE) RETURNING id`,
        [username, email, hash]
      ));
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).render('register', { title: 'Sign up', error: 'That username or email is already taken.' });
      }
      throw e;
    }
    const userId = rows[0].id;
    await db.query('INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    req.session.userId = userId;
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// ---- login ----------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Log in', error: null, next: req.query.next || '/' });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const nextUrl = String(req.body.next || '/');
    // NOTE: login is parameterized on purpose — the SQLi lab lives in search.
    const { rows } = await db.query(
      'SELECT id, password_hash FROM users WHERE lower(email) = $1 OR lower(username) = $1',
      [email]
    );
    const u = rows[0];
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      return res.status(401).render('login', { title: 'Log in', error: 'Invalid credentials.', next: nextUrl });
    }
    await db.query('INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [u.id]);
    req.session.userId = u.id;
    res.redirect(nextUrl.startsWith('/') ? nextUrl : '/');
  } catch (err) {
    next(err);
  }
});

// ---- logout ---------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---- forgot password (#10) ------------------------------------------------
router.get('/forgot-password', (req, res) => {
  res.render('forgot', { title: 'Forgot password', devLink: null, message: null });
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const { rows } = await db.query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
    let devLink = null;
    if (rows[0]) {
      const token = tokenForUser(rows[0].id);
      await db.query('UPDATE users SET reset_token = $1, reset_token_created = now() WHERE id = $2', [token, rows[0].id]);
      // Training convenience: only reveal the link when YOU are resetting YOUR
      // OWN account. This lets a student see the token format (100000 + id)
      // without leaking other users' tokens — the bug is that it's *predictable*.
      if (req.user && req.user.email && req.user.email.toLowerCase() === email) {
        devLink = `/reset-password?token=${token}`;
      }
    }
    res.render('forgot', {
      title: 'Forgot password',
      devLink,
      message: 'If an account exists for that address, a password-reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
});

// ---- reset password (#10: token is predictable AND never expires) ---------
router.get('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const { rows } = await db.query('SELECT id, username FROM users WHERE reset_token = $1', [token]);
    res.render('reset', {
      title: 'Reset password',
      token,
      user: rows[0] || null,
      done: false,
      flag: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    // No expiry check, no ownership check — any valid (predictable) token works.
    const { rows } = await db.query('SELECT id, username FROM users WHERE reset_token = $1', [token]);
    const u = rows[0];
    if (!u || password.length < 4) {
      return res.status(400).render('reset', {
        title: 'Reset password', token, user: u || null, done: false,
        flag: null, error: !u ? 'Invalid or unknown reset token.' : 'Password must be 4+ characters.',
      });
    }
    await db.query('UPDATE users SET password_hash = $1, reset_token = NULL WHERE id = $2',
      [bcrypt.hashSync(password, 8), u.id]);
    res.render('reset', {
      title: 'Reset password', token, user: u, done: true,
      flag: config.FLAGS.auth,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
