# ByteBazaar 🛒💥

**"buy, sell, get hacked responsibly."**

A deliberately vulnerable e-commerce web app — the live hands-on target for the
**Positive Hack Camp — Introduction to Bug Bounty** course (3 sessions × 2h, ~80
students). It looks and behaves like a real marketplace (accounts, products,
reviews, cart/checkout, orders, seller dashboard, admin panel, JSON API) so
students practice recon → exploitation → reporting the way they would on a real
program. Every planted bug returns a `FLAG{bytebazaar_<category>_<random>}`.

> ⚠️ **Authorized training target only.** No real data. Self-contained. Safe to
> attack. Do **not** test any system outside this app.

---

## Prerequisites

Just **Docker** with the **Compose v2** plugin. Nothing else — no local Node,
Python, or database.

```bash
docker --version          # 20.10+ recommended
docker compose version    # v2.x
```

---

## Build & run

From the repo root, either:

**A) Auto-port launcher (recommended)** — finds free host ports (preferring
8080/8081, scanning upward if taken) so it never fails on a busy port, then
builds and starts everything:

```bash
./scripts/start.sh
```

It prints the chosen URLs and writes them to `.env`, so every later
`docker compose` command (`ps`, `logs`, `down`) reuses the same ports. Needs
only bash + Docker.

**B) Plain compose** — uses port **8080** (and 8081 for staging):

```bash
docker compose up -d --build
```

Then open:

- **App:** <http://localhost:8080>
- **Staging (debug build):** <http://localhost:8081>  *(recon target, bug #11)*

> **Port 8080 already in use?** Use the launcher above, or override the host
> ports yourself (defaults stay 8080/8081):
> ```bash
> APP_PORT=18080 STAGING_PORT=18081 docker compose up -d --build
> ```
> (If you used `./scripts/start.sh`, the app/staging URLs it printed are the ones
> to open — they may not be 8080/8081 if those were taken.)

Check everything is healthy:

```bash
docker compose ps          # db/app/staging/internal should be healthy
curl -s http://localhost:8080/healthz
```

### What comes up (`docker-compose.yml`)

| Service | Role | Exposed |
|---------|------|---------|
| `db` | PostgreSQL 16 (data + seed) | internal only |
| `app` | The marketplace | **:8080** |
| `staging` | Same image, `STAGING=true`, `/debug` enabled (bug #11) | **:8081** |
| `reset` | Re-seeds shared data every ~25 min (see below) | internal only |
| `internal` | Internal-only service the SSRF (#8) reaches (`internal.bytebazaar.local`) | internal only |

All services use `restart: unless-stopped` and health checks, so the stack runs
unattended for the full event and recovers from crashes on its own.

---

## Pre-seeded accounts & credentials

### Shared "victim" accounts (identical for everyone)
These have seeded profiles, orders (with PII), and products — the targets for
IDOR / business-logic / auth bugs. They reset on the timer (see below).

| Username | Email | Password | Role |
|----------|-------|----------|------|
| `alice` | `alice@bytebazaar.local` | `spring2024` | user (has orders w/ PII) |
| `bob` | `bob@bytebazaar.local` | `hunter2` | seller |
| `carol` | `carol@bytebazaar.local` | `caroline90` | user |
| `dave` | `dave@bytebazaar.local` | `davedave` | seller |
| `admin` | `admin@bytebazaar.local` | `S3cureAdmin!2024` | admin |

### Student accounts
Each student **self-registers** their own low-privilege account at
<http://localhost:8080/register> (username + email + password). Student accounts
**and their carts/orders persist across resets** — only the shared victim data
resets. (No pre-provisioned `student001…student080` list is needed; if you'd
rather hand out fixed logins, just register them once — they'll persist.)

You log in with **either** the email **or** the username.

---

## Seed-data reset

Shared/victim data (accounts, products, orders, reviews, coupons, secrets)
**auto-resets every ~25 minutes** via the `reset` container, so one student's
exploitation (stored XSS, cancelled orders, a reset victim password, etc.)
doesn't block everyone else. Student-owned data is never touched.

**Trigger a reset manually, mid-event:**

```bash
docker compose exec app node src/seed.js
```

Change the cadence with `RESET_INTERVAL_MS` (default `1500000` = 25 min) in
`docker-compose.yml`.

---

## The answer key

The internal instructor answer key — which endpoint/payload triggers which flag,
with copy-paste PoCs for all 12 bugs — lives in **[`ANSWER_KEY.md`](ANSWER_KEY.md)**.
For coaching the room live, **[`INSTRUCTOR_NOTES.md`](INSTRUCTOR_NOTES.md)** is
the discovery-path-first companion (breadcrumb + escalating "stuck-nudge" per
flag). **Don't hand either to students.**

Verify every flag end-to-end against a running stack:

```bash
./scripts/verify.sh
# or, with overridden ports:
BASE=http://localhost:18080 STAGING=http://localhost:18081 ./scripts/verify.sh
```

It registers a throwaway account and exercises all 12 bugs, printing PASS/FAIL
per bug. (Any damage it does to seed data self-heals on the next reset.)

---

## The planted bugs (student-facing summary)

Twelve intentional bugs, mapped to the course sessions. Details/payloads are in
the answer key.

| # | Class | Where | Session |
|---|-------|-------|---------|
| 1 | Inspect traffic (warm-up) | Any response header/cookie | 1 |
| 2 | Client-side trust | `/api/me` `isAdmin` field | 1–2 |
| 3 | Reflected XSS | Search `?q=` | 2 |
| 4 | Stored XSS | Product review | 2 |
| 5 | SQL injection | Product search filter | 2 |
| 6 | IDOR | `GET /api/orders/{id}` | 2 |
| 7 | Broken access control | `/admin`, `/api/admin/stats` | 2 |
| 8 | SSRF | Seller "import image from URL" | 2 |
| 9 | Business logic | Coupon stacking at checkout | 2–3 |
| 10 | Auth/session | Predictable password-reset token | 2–3 |
| 11 | Recon disclosure | `/.git/`, stack trace, JS key, staging `/debug` | 2 |
| 12 | Hidden bonus (BFLA) | `POST /api/orders/{id}/cancel` | 3 |

The footer disclaimer and the `/api/docs` page are in-app starting points.

---

## Scale

Built to hold ~80 concurrent lab users from a single `docker compose up -d`:
PostgreSQL connection pooling (30 connections), stateless request handling, and
health-checked auto-restart. A quick local check ran **240 requests at 80-way
concurrency with 0 errors**. To sanity-check on your host:

```bash
# simple parallel smoke test
seq 240 | xargs -P80 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:8080/api/products | sort | uniq -c
```

---

## Teardown

```bash
docker compose down        # stop + remove containers and network
docker compose down -v     # ...and also wipe the database volume (full reset)
```

---

## Repo layout

```
docker-compose.yml      # one command brings up the whole stack
README.md               # this file
ANSWER_KEY.md           # instructor answer key (flags + PoCs)
course/                 # course slides — Introduction to Bug Bounty (session deck)
app/                    # the marketplace (Node/Express + EJS + Postgres)
  Dockerfile
  db/schema.sql         # schema (idempotent)
  src/config.js         # central config + FLAG registry
  src/seed.js           # schema + seed + reset loop
  src/routes/           # feature routes (bugs live here)
  src/views/            # EJS templates
  git_exposed/dotgit    # the intentionally-exposed repo, served at /.git (#11a)
internal/               # internal-only SSRF target (#8)
scripts/start.sh        # auto-port launcher (recommended entry point)
scripts/verify.sh       # end-to-end flag verifier
scripts/git_recon.py    # git-dumper-lite for the /.git recon lab
```

Tech stack: **Node.js 20 + Express + EJS + PostgreSQL 16**, fully Dockerized.
