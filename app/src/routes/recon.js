'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

// ---- #11 staging debug endpoint -------------------------------------------
// Only live on the staging instance (STAGING=true -> staging.bytebazaar.local,
// published on :8081). On production (:8080) this 404s, so it must be found via
// subdomain/vhost recon. Dumps debug info + the staging recon flag.
router.get('/debug', (req, res) => {
  if (!config.staging) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Page not found', stack: null });
  }
  res.json({
    service: 'bytebazaar-staging',
    message: 'Staging debug endpoint — DO NOT SHIP TO PROD',
    env: config.env,
    node: process.version,
    internal_service: config.internalService,
    fake_internal_api_key: config.fakeInternalApiKey,
    flag: config.FLAGS.recon_staging,
    headers: req.headers,
  });
});

// A tiny "who am I" helper that echoes request metadata — handy for the
// intercept warm-up (#1) and shows the reward header is really being sent.
router.get('/whoami', (req, res) => {
  res.json({
    ip: req.ip,
    method: req.method,
    path: req.path,
    cookies: req.cookies,
    user_agent: req.get('user-agent') || null,
    hint: 'Check the response headers of any page for your first warm-up flag.',
  });
});

module.exports = router;
