'use strict';

// ---------------------------------------------------------------------------
// ByteBazaar central configuration + FLAG registry.
//
// Flags are FIXED (not random-per-run) so they stay stable across the periodic
// seed-data reset and every student who solves a bug sees the same value. The
// hex suffixes just make them look "random" for the CTF vibe.
//
// The full mapping of flag -> vulnerability lives in ANSWER_KEY.md.
// ---------------------------------------------------------------------------

const FLAGS = {
  // #1  warm-up: hidden in normal HTTP response traffic (header + cookie)
  intercept:      'DCTF{bytebazaar_intercept_a1c0ffee42}',
  // #2  client-side trust: sent in /api/me, UI trusts isAdmin to hide it
  clientside:     'DCTF{bytebazaar_clientside_7b3d2f9a}',
  // #3  reflected XSS: search box ?q= reflected unescaped
  reflected_xss:  'DCTF{bytebazaar_reflected_xss_9e4a1177}',
  // #4  stored XSS: product review body rendered unescaped
  stored_xss:     'DCTF{bytebazaar_stored_xss_2c8fd6b0}',
  // #5  SQL injection: product search filter (UNION -> secrets table)
  sqli:           'DCTF{bytebazaar_sqli_5f0b7e33}',
  // #6  IDOR: GET /api/orders/:id leaks other users' order (PII)
  idor:           'DCTF{bytebazaar_idor_d41d8ce7}',
  // #7  broken access control: /api/admin/stats with no server role check
  bac:            'DCTF{bytebazaar_bac_6a9f2b41}',
  // #8  SSRF: import-image-from-url reaches internal.bytebazaar.local
  ssrf:           'DCTF{bytebazaar_ssrf_e3b0c442}',
  // #9  business logic: coupon stacking drives total <= 0 at checkout
  logic:          'DCTF{bytebazaar_logic_1337c0de}',
  // #10 auth/session: predictable, non-expiring password-reset token
  auth:           'DCTF{bytebazaar_auth_beef4200}',
  // #11 recon-only info disclosure (four sub-artifacts)
  recon_git:      'DCTF{bytebazaar_recon_git_ba5eba11}',
  recon_stack:    'DCTF{bytebazaar_recon_stacktrace_0badf00d}',
  recon_jskey:    'DCTF{bytebazaar_recon_jskey_ca11ab1e}',
  recon_staging:  'DCTF{bytebazaar_recon_staging_5ta91n9}',
  // #12 hidden bonus: BFLA - cancel ANY user's order (session 3)
  bonus:          'DCTF{bytebazaar_bonus_bola_deadc0de}',
};

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  // Deliberately NOT production: verbose errors / stack traces are ON.
  env: process.env.NODE_ENV || 'training',
  // A weak, hardcoded session secret (intentionally checked into the repo).
  sessionSecret: process.env.SESSION_SECRET || 'bytebazaar-super-secret-do-not-copy',
  // STAGING=true turns this instance into staging.bytebazaar.local (debug on)
  staging: String(process.env.STAGING || '').toLowerCase() === 'true',
  // Internal-only service the SSRF is meant to reach.
  internalService: process.env.INTERNAL_SERVICE_URL || 'http://internal.bytebazaar.local',
  db: {
    host: process.env.PGHOST || 'db',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'bytebazaar',
    password: process.env.PGPASSWORD || 'bytebazaar',
    database: process.env.PGDATABASE || 'bytebazaar',
    // Pool sized to comfortably serve ~80 concurrent lab users.
    max: parseInt(process.env.PG_POOL_MAX || '30', 10),
  },
  resetIntervalMs: parseInt(process.env.RESET_INTERVAL_MS || String(25 * 60 * 1000), 10),
  // A fake "internal API key" that ALSO gets leaked in the JS bundle (#11).
  fakeInternalApiKey: 'phc_live_sk_9c2f1e77b0a4d3internalbilling',
  FLAGS,
};

module.exports = config;
