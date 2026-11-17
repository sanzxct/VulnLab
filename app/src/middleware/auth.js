'use strict';

const db = require('../db');
const config = require('../config');

// Populate req.user / res.locals.currentUser from the session on every request.
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.config = config;
  res.locals.path = req.path;
  res.locals.flash = null;
  try {
    if (req.session && req.session.userId) {
      const { rows } = await db.query(
        `SELECT id, username, email, role, is_admin, bio, avatar_url, full_name, address, member_since
           FROM users WHERE id = $1`,
        [req.session.userId]
      );
      if (rows[0]) {
        req.user = rows[0];
        res.locals.currentUser = rows[0];
      }
    }
  } catch (err) {
    // A DB hiccup shouldn't nuke anonymous browsing.
    console.error('[auth] loadUser error:', err.message);
  }
  next();
}

// Gate for pages that genuinely require *a* logged-in user (not a role check).
function requireLogin(req, res, next) {
  if (!req.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

module.exports = { loadUser, requireLogin };
