# insureOnGo Embedded — where things stand

A one-click device-protection offer for a merchant's product page. insureOnGo (the
existing platform) does the insurer matching, pricing and policy issuing; this project
asks it, stores what comes back, and keeps our commission.

All six remaining tasks are finished. **253 tests pass**: 223 server, 21 widget, 8 web,
1 end-to-end.

---

## Layout

Four separate packages, no workspaces. Install in each one.

| Directory | What it is |
|---|---|
| `server/` | The API, the workers and the database schema. Express, Drizzle, Postgres |
| `web/` | Merchant signup, dashboard, setup guide, and the admin pages. React + Vite |
| `widget/` | The `insureongo-offer` element merchants embed. No framework, no dependencies |
| `e2e/` | One Playwright test driving a real browser against a real server |

## Running it

```bash
docker compose up                       # api, web, postgres, redis

npm test --prefix server                # needs postgres on 55432 and redis on 6379
npm test --prefix widget                # no services needed
npm test --prefix web                   # no services needed
npm run test:e2e                        # starts its own api and fixture server

npm run db:migrate  --prefix server     # apply migrations
npm run db:generate --prefix server     # create a new one
npm run build       --prefix widget     # bundle, and fail if over 15 KB gzipped
```

The server tests expect Postgres on **55432** (`postgres/test/insurance_test`), which is
deliberately not the dev database on 5432. `TEST_DATABASE_URL` overrides it. Redis comes
from `REDIS_URL`, and `REDIS_PREFIX` namespaces the queue keys so one Redis can carry
more than one environment.

Browsers for Playwright download from `cdn.playwright.dev`. Where that host is
unreachable, `PLAYWRIGHT_CHANNEL=msedge` drives an already-installed browser instead.

Environment variables are listed in [`server/docs/deployment.md`](server/docs/deployment.md).

---

## What is built

### The widget

One file, `GET /widget/v1/insureongo.js`, cached for 5 minutes. **2,853 B gzipped**
against a 15 KB budget. A merchant adds a script tag and an element; nothing else is
configured, because the widget reads the API address from its own `src`.

Everything lives in a shadow DOM, so merchant styles cannot break it and its styles
cannot leak. Two custom properties pass through: `--insureongo-accent` and
`--insureongo-font`.

It asks for quotes on load, shows the top one, and offers the rest behind an "Other
options" button when there are two or more. On a 204, an error, a timeout or anything
that is not a valid list it renders nothing and throws nothing — it never breaks the
merchant's page or shows a shopper an error. Changing the item's price, name, category or
condition re-asks after 300 ms.

Three ways to hand the choice to a cart: `element.value`, a `change` plus an
`insureongo:change` event, and form submission as `insureongo_quote_id`.

### Quotes and CORS

`POST /v1/quotes` returns 204 when there is no offer, or 200 with an array whose first
entry is the top quote.

The preflight handler is mounted **before** the auth check, and this ordering matters: a
browser sends no custom headers on an `OPTIONS` request, so there is no public key for
the auth check to read, and it would answer 401 before the widget ever got to send its
POST. Because there is no store to check against on a preflight, it allows the origin if
**any** active store lists it; the real POST is still checked against its own store.

### Weekly bill

Friday 08:00 Lagos. One bill per store per week, the policies stamped so they are never
billed twice, emailed to the store's billing address.

The settlement row is found or created **first**, and sending is its own step. This is
the whole point: if the email fails, the policies already carry a `settlementId`, so a
run that looked for unbilled policies first would find none, skip the store, and never
send the bill. There is a test for exactly that.

Email sits behind an interface with an in-memory fake. Until a provider is chosen, the
real sender only logs the address.

### Quote cleanup

Daily 03:00 Lagos. Deletes expired quotes nothing points to, 1,000 at a time. The policy
check is repeated inside the `DELETE` on purpose: `policies.quoteId` has no `ON DELETE`
rule, so a quote that gained a policy mid-run would otherwise raise a foreign key error.

### Queue

BullMQ on Redis. The receiver adds one job per newly saved event, using the
`webhook_events` row id as the job id, so an event can never be queued twice. **10
attempts**, exponential backoff from **1 minute**, **5 at a time**; after the last failed
attempt the event is marked `failed` with the reason in `error`.

A sweep every 10 minutes queues anything still `received` after 5 minutes, covering a job
that was never added or was lost.

Schedules live in one file. The job functions take no interest in queues or clocks, and
tests assert they import nothing about either. Details in
[`server/docs/issuance-worker.md`](server/docs/issuance-worker.md).

### Setup guide

`/setup` in the dashboard, filled with the signed-in store's own public key and webhook
address, and showing no secret of any kind.

The Node signing example is not copy-pasted prose: it is exported from one module, shown
on the page, and **executed by a server test** that checks the real verifier accepts the
result. The instructions cannot drift from what we actually accept.

### Hosting

CI runs on every pull request with Postgres and Redis as services, and applies the
migrations to an empty database as its own early step so a bad migration fails with an
obvious name.

`GET /health` runs `select 1`: 200 when the database answers, 503 when it does not.

Sentry initialises only when `SENTRY_DSN` is set and is inert otherwise. Tracing is off
on purpose — sampled request bodies would carry customer details.

---

## Worth knowing

Things that are easy to get wrong later.

- **`premium` arrives as a string.** It is a `numeric` column, so JSON gives
  `"54000.00"`. Convert before formatting or doing arithmetic.
- **The quote request body is strict.** Any unknown key is a 400, and a 400 renders
  nothing silently. Send exactly the five accepted fields and leave `storeItemRef` out
  when there isn't one, rather than sending `null`.
- **Lagos is UTC+1 with no daylight saving**, so Friday 00:00 Lagos is Thursday 23:00
  UTC. `periodStart` and `periodEnd` are `date` columns and lose that offset, so policies
  are compared against the derived instant, not the date.
- **Allowed domains include subdomains.** `3chub.com` allows `www.3chub.com` but not
  `evil3chub.com` or `3chub.com.evil.com`. One matcher serves both the auth check and
  the preflight, so they cannot drift.
- **The widget's public-key header name is not final.** Changing it means re-cutting the
  bundle, which merchants cache for 5 minutes.
- **Migrations never run on container start.** Every instance booting at once would run
  them in parallel. They are a separate task before the new version takes traffic.
- **Neither jsdom nor happy-dom implements `ElementInternals.setFormValue`.** That is why
  the form-field behaviour is proven in Playwright and only recorded in unit tests.

## Loose ends

- **`runIssuanceWorker` is only used by tests.** Nothing in `src` calls it now that the
  queue took over. It is a candidate for deletion if a test-only entry point is not
  wanted.
- **The webhook signature covers the body but not the timestamp**, so a captured
  signature replays inside the 5-minute window. The unique `eventId` makes a replay
  harmless. This is now documented to merchants, which makes it permanent — worth a
  deliberate decision rather than leaving it as an accident. Signing
  `timestamp + "." + body` would close it, at the cost of changing a rule merchants have
  been given.
- **Nothing watches the `failed` pile.** An event that gives up after 10 attempts needs a
  human. The alert for it is in the not-done list below.
- **`woocommerce` was dropped from signup.** It had no verifier and no paid-order
  extractor, so its webhook address returned 404 and its events never issued. Only
  `custom` is offered. Adding it back means building a real verifier.
- **Custom product categories cannot be quoted.** Signup lets merchants name their own
  products, but the quote endpoint accepts only `phones`, `laptops` and `tablets`. The
  setup guide says so.

## Not done

### Needs an AWS account and a Sentry project

The application side is ready for all of it; none could be set up without credentials.
ECS Fargate, RDS, ElastiCache, Secrets Manager entries, a migration task in the deploy,
CloudWatch, and a Sentry project for the DSN.

A deploy workflow was deliberately not written: one naming cluster, service and role ARNs
that do not exist yet would look finished and fail on first use.

Alerts still to set up: the issuance queue backing up, any `webhook_events` row reaching
`failed`, and the weekly bill not running on a Friday — that last one should watch for a
missing `settlements` row, because a job that runs and bills nothing looks identical to
one that never ran.

### Waiting on other people

| Item | Waiting on | What changes when it unblocks |
|---|---|---|
| Real insureOnGo quote and issue calls | insureOnGo's API details | Replace the fake client in its one file. Nothing else changes |
| Repeat-call protection at insureOnGo | The underwriter confirming they honour `issuanceKey` | The issue call already sends it. Confirm their side uses it |
| "Amount due" on the weekly bill | The agreement on who pays whom | Add the line and a column on `settlements` |
| Real email sending | Choosing a provider | Implement the existing email interface with it |

Production needs its **own** `ENCRYPTION_KEY`, backed up somewhere safe. Lose it and
every stored webhook secret becomes unreadable, and no store's webhooks can be verified
again.
