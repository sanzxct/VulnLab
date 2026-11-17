'use strict';

// ---------------------------------------------------------------------------
// internal.bytebazaar.local — an internal-only microservice.
//
// This container is NOT published to the host. The only way to reach it is
// from inside the Docker network, e.g. via the SSRF in the seller "import
// image from URL" feature (#8). Hitting /secret returns the SSRF flag.
// ---------------------------------------------------------------------------

const http = require('http');

const SSRF_FLAG = process.env.SSRF_FLAG || 'FLAG{bytebazaar_ssrf_e3b0c442}';
const PORT = parseInt(process.env.PORT || '80', 10);

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/secret' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'bytebazaar-internal-billing',
      warning: 'INTERNAL ONLY — this host is not exposed to the internet.',
      note: 'If you can read this from the public app, you have SSRF.',
      internal_db: 'postgres://billing:billing@db-internal:5432/ledger',
      flag: SSRF_FLAG,
    }, null, 2));
    return;
  }
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', tip: 'try /secret' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[internal] internal-only service listening on :${PORT}`);
});
