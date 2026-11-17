# ByteBazaar — Instructor Coaching Notes 🔑

**Private. Keep off the projector.** This is the "how do students *find* it, and
what do I whisper when they're stuck" sheet — the discovery path first, exploit
second, flag last. Full copy-paste PoCs live in the repo's `ANSWER_KEY.md`.

---

## Setup you need in front of you

**Ports.** `./scripts/start.sh` picks free ports and prints them (and writes
`.env`). If 8080 is busy it shifts up — in this room the app came up on **:8081**,
staging on **:8082**. Everything below writes `:8080`/`:8081`; substitute the
URLs the launcher actually printed. Quick check: `docker compose ps`.

**Victim accounts** (shared, reset every ~25 min):

| User | Login | Password | Role | Reset token |
|------|-------|----------|------|-------------|
| alice | alice@bytebazaar.local | `spring2024` | user, has PII orders | 100001 |
| bob | bob@bytebazaar.local | `hunter2` | seller | 100002 |
| carol | carol@bytebazaar.local | `caroline90` | user | 100003 |
| dave | dave@bytebazaar.local | `davedave` | seller | 100004 |
| admin | admin@bytebazaar.local | `S3cureAdmin!2024` | admin | 100005 |

Students self-register their own account (id ≥ 1001); their data survives resets,
victim data self-heals every ~25 min. Force a reset: `docker compose exec app node src/seed.js`.

**Universal recon starting points to point people at:** the footer disclaimer,
`/robots.txt`, `/api/docs`, and the JS bundle `/js/app.js`. Most breadcrumbs
chain from these four.

---

## Session 1 — warm-up

### #1 Intercept header · `FLAG{bytebazaar_intercept_a1c0ffee42}`
- **Breadcrumb:** HTML comment in every page's `<head>` says every response
  carries `X-PHC-Intercept-Reward`. Also `/api/whoami` hints at it.
- **Find → exploit:** open Burp / DevTools Network, load any page, read response
  headers. `curl -si <app>/ | grep -i x-phc`.
- **Stuck-nudge:** "Your proxy sees more than the browser renders. Look at the
  *response headers*, not the body."

### #2 Client-side trust · `FLAG{bytebazaar_clientside_7b3d2f9a}`
- **Breadcrumb:** `/api/docs` lists `/api/me`; `/js/app.js` shows it only *renders*
  `hidden_admin_flag` when `isAdmin === true`.
- **Find → exploit:** logged in, `GET /api/me` already contains `hidden_admin_flag`
  in the JSON. Live "aha": intercept the **response**, flip `"isAdmin":false` →
  `true`; the admin teaser (bottom-right) pops with the flag and the Admin nav
  link appears.
- **Stuck-nudge:** "The server already sent you everything. Read the raw JSON, or
  tamper the response instead of the request." (This is the client-side twin of
  #7 — same trust failure, one client-side, one server-side.)

---

## Session 2 — the main block

### #3 Reflected XSS · `FLAG{bytebazaar_reflected_xss_9e4a1177}`
- **Breadcrumb:** the search box in the nav (every page).
- **Find → exploit:** `search?q=<script>alert(document.cookie)</script>` — reflected
  unescaped. Flag is in the non-HttpOnly `rxss_reward` cookie the alert reveals.
- **Stuck-nudge:** "What happens to your search term on the results page? View
  source and search for it."

### #4 Stored XSS · `FLAG{bytebazaar_stored_xss_2c8fd6b0}`
- **Breadcrumb:** the "Leave a review" form on any product page (login required).
- **Find → exploit:** post a review with body `<script>alert(document.cookie)</script>`;
  it's rendered unescaped. Flag in the non-HttpOnly `sxss_reward` cookie.
- **⚠ Room-stability note (important for you):** the review feed is now scoped
  **per student** — each sees the seed reviews plus *their own*, never other
  students'. This stops 80 payloads from firing on every page load. **Tell the
  class explicitly:** the filter is a lab constraint, NOT how the bug behaves —
  on a real site every visitor executes what you stored. The vuln is unchanged
  (stored raw, rendered unescaped); only *whose rows* are shown changed. Left
  unsaid, students wrongly conclude stored XSS "only affects yourself."
- **Stuck-nudge:** "Persist a payload instead of reflecting one. Where does user
  text get saved and shown back later?"

### #5 SQL injection · `FLAG{bytebazaar_sqli_5f0b7e33}`
- **Breadcrumb:** same search box (only the search filter is injectable; login is
  parameterized, so don't let them rabbit-hole on the login form).
- **Find → exploit:** error-based `?q='` leaks the query ("Database error…").
  UNION exfil of the `secrets` table:
  `?q=zzz' UNION SELECT id, secret_value, 0, name, '', '' FROM secrets-- -` →
  flag shows up as a product "name".
- **Stuck-nudge:** "A single quote in search does something interesting. Then:
  how many columns does the results table have?" (6 — that's the UNION shape.)

### #6 IDOR · `FLAG{bytebazaar_idor_d41d8ce7}`
- **Breadcrumb:** the **My orders** page tip — "also exposed as JSON at
  `/api/orders/<id>`" and "ids are one shared sequence… earliest start at #1."
- **Find → exploit:** logged in as *anyone*, `GET /api/orders/1` (Alice's) — no
  ownership check on the API. Gift message hides the flag + leaks PII. (The
  HTML page `/orders/1` *does* enforce ownership; the JSON twin forgot to.)
- **Stuck-nudge:** "Your orders start at 1001. What lives at id 1? Try the JSON
  endpoint, not the web page."

### #7 Broken access control · `FLAG{bytebazaar_bac_6a9f2b41}`
- **Breadcrumb:** `/robots.txt` disallows `/admin` and `/admin/users`; the
  `/admin` panel now links its JSON twin `/api/admin/stats`.
- **Find → exploit:** `/admin` renders the flag with *no role check* — reach it as
  a low-priv student. `/api/admin/stats` returns it with **no session at all**.
  `/admin/users` dumps the whole user table (feeds #10).
- **Note:** the API path isn't brute-forceable and appears nowhere else — students
  get here via `/admin` (from robots.txt), then follow the link. If someone only
  found the API, great, but `/admin` is the intended door.
- **Stuck-nudge:** "robots.txt is a list of things they *don't* want you to see."

### #8 SSRF · `FLAG{bytebazaar_ssrf_e3b0c442}`
- **Breadcrumb:** seller dashboard → "Import product image from URL". The target
  host is leaked three ways: `/js/app.js` (`internalApiBase`), the dumped
  `internal_notes.md` (#11a) with the full `…/secret` URL, and the internal
  service's own 404 says "try /secret".
- **Find → exploit:** as a logged-in seller, `POST /seller/import-image` with
  `url=http://internal.bytebazaar.local/secret`. Response body (the internal
  service's JSON) is reflected back with the flag. The internal container is
  **not** published to the host — only reachable *through* the app, so it's true
  SSRF.
- **Stuck-nudge:** "That importer fetches server-side. What can the *server* reach
  that you can't? Check the JS bundle for internal hostnames."

### #9 Business-logic — coupon stacking · `FLAG{bytebazaar_logic_1337c0de}`
- **Breadcrumb:** the cart's coupon box literally says "try WELCOME10, SAVE25,
  HALFOFF."
- **Find → exploit:** no dedupe, no floor. Add "Braided USB-C Cable" ($12.99),
  apply `HALFOFF` twice (50%+50% = $0.00), or `SAVE25` once on a sub-$25 cart
  (negative total). Place order → flag.
- **Stuck-nudge:** "What if you apply the same coupon twice? Watch the total."

### #10 Auth — predictable reset token · `FLAG{bytebazaar_auth_beef4200}`
- **Breadcrumb:** the forgot-password page shows *your own* reset link (no mail
  server) and asks "notice anything about the token value?" Victim ids/emails
  come from `/admin/users` (#7).
- **Find → exploit:** token = `100000 + user_id`, never expires. Request a reset
  for your own account → see the pattern → Alice is id 1 → `token=100001`.
  `GET /reset-password?token=100001`, then POST a new password → flag, and you
  own Alice's account.
- **Shared-event gotcha:** token is single-use. If `100001` is already consumed,
  re-arm it with `POST /forgot-password email=alice@bytebazaar.local` (no auth) —
  then it's `100001` again. Or wait for the ~25-min reseed.
- **Stuck-nudge:** "Reset your *own* password first and stare at the token. Then
  ask what alice's user id is."

### #11 Recon block (four flags)
- **11a exposed `.git`** · `FLAG{bytebazaar_recon_git_ba5eba11}`
  - **Breadcrumb:** `/robots.txt` disallows `/.git/` (browsable).
  - **Exploit:** dump it (`git-dumper <app>/.git/ out/` or `scripts/git_recon.py`),
    read `internal_notes.md` — flag + the internal host + the CI key. `git log` /
    `git show HEAD~1:internal_notes.md` also work from a checkout.
- **11b verbose stack trace** · `FLAG{bytebazaar_recon_stacktrace_0badf00d}`
  - **Breadcrumb:** `/api/docs` lists `/api/products/{id}`; feeding a bad type
    500s.
  - **Exploit:** `GET /api/products/abc` → `.debug.build` holds the flag (also on
    the HTML page `/product/abc`).
- **11c hardcoded key in JS** · `FLAG{bytebazaar_recon_jskey_ca11ab1e}`
  - **Breadcrumb:** `/api/docs` says "read the JavaScript."
  - **Exploit:** open `/js/app.js` → `CONFIG.buildFlag` (+ a fake internal API key).
- **11d staging debug** · `FLAG{bytebazaar_recon_staging_5ta91n9}`
  - **Breadcrumb:** `/robots.txt` names `staging.bytebazaar.local` and now notes
    it doesn't resolve externally and sits **one port above prod** (prod :8080 →
    staging :8081; in this room :8081 → :8082).
  - **Exploit:** hit staging's `/debug` (404 on prod) → `.flag`.
  - **Note:** if you shifted ports oddly, just tell the room the staging URL — the
    robots hint assumes a +1 offset.

---

## Session 3 — timed bonus

### #12 BFLA — cancel any order · `FLAG{bytebazaar_bonus_bola_deadc0de}`
- **Breadcrumb (deliberately thin — this is the unaided exercise):** the order
  detail page for *your own* order has a "Cancel this order" button. That's the
  **only** place `POST /api/orders/{id}/cancel` is exposed — no docs entry, no
  robots line, and the rationale comment is server-side EJS so it's NOT in the
  page source.
- **Find → exploit:** place your own order, click Cancel, catch the request in the
  proxy, replay it with a victim's id (or another student's, id ≥ 1001). No
  ownership check → order flips to `cancelled` and the response carries the flag.
  Cancelling your *own* order returns success but **no flag** (by design).
- **Stuck-nudge (escalate slowly):** 1) "You can cancel your own order — watch the
  request." 2) "What's in the URL?" 3) "Whose order is #1?" Don't hand them the
  endpoint; the whole point is they find the missing authz themselves.

---

## Quick flag index

| # | Flag |
|---|------|
| 1 | `FLAG{bytebazaar_intercept_a1c0ffee42}` |
| 2 | `FLAG{bytebazaar_clientside_7b3d2f9a}` |
| 3 | `FLAG{bytebazaar_reflected_xss_9e4a1177}` |
| 4 | `FLAG{bytebazaar_stored_xss_2c8fd6b0}` |
| 5 | `FLAG{bytebazaar_sqli_5f0b7e33}` |
| 6 | `FLAG{bytebazaar_idor_d41d8ce7}` |
| 7 | `FLAG{bytebazaar_bac_6a9f2b41}` |
| 8 | `FLAG{bytebazaar_ssrf_e3b0c442}` |
| 9 | `FLAG{bytebazaar_logic_1337c0de}` |
| 10 | `FLAG{bytebazaar_auth_beef4200}` |
| 11a | `FLAG{bytebazaar_recon_git_ba5eba11}` |
| 11b | `FLAG{bytebazaar_recon_stacktrace_0badf00d}` |
| 11c | `FLAG{bytebazaar_recon_jskey_ca11ab1e}` |
| 11d | `FLAG{bytebazaar_recon_staging_5ta91n9}` |
| 12 | `FLAG{bytebazaar_bonus_bola_deadc0de}` |

**Sanity-check the whole board before a session:**
`BASE=http://localhost:8081 STAGING=http://localhost:8082 ./scripts/verify.sh`
→ expect **19/19 PASS**.
