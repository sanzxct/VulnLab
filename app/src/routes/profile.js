'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
// Accept images only, and give each user exactly ONE avatar slot (fixed name),
// so avatar uploads can't grow unbounded and fill the host disk (the reset job
// only heals the DB, not the filesystem). Re-uploads overwrite / are pruned.
const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg',
};
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `u${req.user.id}${MIME_EXT[file.mimetype] || '.img'}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(MIME_EXT[file.mimetype])),
});

// Keep only the just-uploaded avatar for this user; delete any older ones.
function pruneOldAvatars(userId, keep) {
  try {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (f.startsWith(`u${userId}.`) && f !== keep) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* ignore */ }
}

router.get('/profile', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, email, role, bio, avatar_url, full_name, address, member_since FROM users WHERE id = $1',
      [req.user.id]
    );
    res.render('profile', { title: 'My profile', profile: rows[0], flash: req.query.msg || null });
  } catch (err) { next(err); }
});

router.post('/profile', requireLogin, async (req, res, next) => {
  try {
    const bio = String(req.body.bio || '').slice(0, 2000);
    const fullName = String(req.body.full_name || '').slice(0, 200);
    const address = String(req.body.address || '').slice(0, 300);
    const email = String(req.body.email || '').trim().toLowerCase();
    await db.query(
      'UPDATE users SET bio = $1, full_name = $2, address = $3, email = COALESCE(NULLIF($4, \'\'), email) WHERE id = $5',
      [bio, fullName, address, email, req.user.id]
    );
    res.redirect('/profile?msg=Profile+updated');
  } catch (err) {
    if (err.code === '23505') return res.redirect('/profile?msg=Email+already+in+use');
    next(err);
  }
});

router.post('/profile/avatar', requireLogin, upload.single('avatar'), async (req, res, next) => {
  try {
    if (req.file) {
      pruneOldAvatars(req.user.id, req.file.filename);
      await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2',
        ['/uploads/' + req.file.filename, req.user.id]);
      return res.redirect('/profile?msg=Avatar+updated');
    }
    res.redirect('/profile?msg=Please+choose+an+image+file');
  } catch (err) { next(err); }
});

module.exports = router;
