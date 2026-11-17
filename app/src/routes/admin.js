'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

// ---- #7 broken access control ---------------------------------------------
// These admin pages are only *linked* in the UI for admins (the navbar hides
// them based on the client-side isAdmin from /api/me, see #2). But there is NO
// server-side role check here, so any session — or no session at all — can hit
// them directly by URL. This is the real backend flaw behind bug #2.

router.get('/admin', async (req, res, next) => {
  try {
    const [{ rows: u }, { rows: p }, { rows: o }, { rows: rev }] = await Promise.all([
      db.query('SELECT count(*)::int AS n FROM users'),
      db.query('SELECT count(*)::int AS n FROM products'),
      db.query('SELECT count(*)::int AS n FROM orders'),
      db.query('SELECT COALESCE(sum(total),0)::numeric AS s FROM orders'),
    ]);
    const stats = {
      users: u[0].n,
      products: p[0].n,
      orders: o[0].n,
      revenue: Number(rev[0].s),
    };
    res.render('admin', { title: 'Admin — site stats', stats, flag: config.FLAGS.bac });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/users', async (req, res, next) => {
  try {
    const { rows: users } = await db.query(
      `SELECT id, username, email, role, is_admin, full_name, member_since
         FROM users ORDER BY id`
    );
    res.render('admin_users', { title: 'Admin — user management', users, flag: config.FLAGS.bac });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
