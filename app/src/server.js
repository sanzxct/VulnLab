'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const serveIndex = require('serve-index');

const config = require('./config');
const db = require('./db');
const { runSchema, reseed } = require('./seed');
const { loadUser } = require('./middleware/auth');

const app = express();
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- body/cookie parsing --------------------------------------------------
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ---- sessions -------------------------------------------------------------
app.use(session({
  name: 'bb.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

// ---- warm-up / recon traffic (#1) -----------------------------------------
// Every response advertises the server and drops a "reward" header + a
// deliberately non-HttpOnly hint cookie, so the Burp intercept warm-up lab has
// real, inspectable traffic to look at.
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'ByteBazaar/1.0 (Express)');
  res.setHeader('X-PHC-Intercept-Reward', config.FLAGS.intercept);
  if (!req.cookies || !req.cookies.bb_visited) {
    res.cookie('bb_visited', '1', { httpOnly: false, sameSite: 'lax' });
  }
  next();
});

// ---- exposed .git (#11 recon) ---------------------------------------------
// A real (tiny) git repo is served at /.git with directory listing enabled so
// students can dump it (git-dumper / manual object fetching). It is stored on
// disk as git_exposed/dotgit (NOT a literal ".git") so that committing this
// project to an outer git repo doesn't treat it as an embedded repo and drop
// its objects — it is served at the URL path /.git regardless of disk name.
const gitDir = path.join(__dirname, '..', 'git_exposed', 'dotgit');
app.use('/.git', serveIndex(gitDir, { icons: true }));
app.use('/.git', express.static(gitDir, { dotfiles: 'allow' }));

// ---- static assets --------------------------------------------------------
app.use('/', express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));

// ---- per-request user context ---------------------------------------------
app.use(loadUser);

// ---- health check ---------------------------------------------------------
app.get('/healthz', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', staging: config.staging });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// ---- feature routes -------------------------------------------------------
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/profile'));
app.use('/', require('./routes/shop'));
app.use('/', require('./routes/cart'));
app.use('/', require('./routes/orders'));
app.use('/', require('./routes/seller'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/recon'));
app.use('/api', require('./routes/api'));

// ---- 404 ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404);
  if (req.accepts('html')) return res.render('error', { title: 'Not Found', message: 'Page not found', stack: null });
  res.json({ error: 'not_found' });
});

// ---- error handler (#11: verbose stack traces are intentionally ON) --------
app.use((err, req, res, next) => {
  console.error('[error]', err.stack || err.message);
  res.status(err.status || 500);
  // Full stack + a leaked build note (recon flag) — this is deliberate.
  const debug = {
    stack: err.stack,
    build: `ByteBazaar internal build note: ${config.FLAGS.recon_stack}`,
    env: config.env,
  };
  if (req.path.startsWith('/api')) {
    return res.json({ error: 'internal_error', message: err.message, debug });
  }
  res.render('error', { title: 'Server Error', message: err.message, stack: `${err.stack}\n\n${debug.build}` });
});

// ---- boot -----------------------------------------------------------------
async function boot() {
  await db.waitForDb();
  await runSchema();
  try {
    await reseed();
    console.log('[boot] initial seed complete.');
  } catch (err) {
    console.error('[boot] initial seed failed (continuing):', err.message);
  }
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[boot] ByteBazaar listening on :${config.port} (staging=${config.staging}, env=${config.env})`);
  });
}

boot().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});

module.exports = app;
