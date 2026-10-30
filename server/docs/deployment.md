# Hosting, CI and monitoring

What is in the repository, and what still needs an AWS account to finish.

## In the repository

### CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every pull request
and on pushes to `main`, with Postgres and Redis as services. In order:

1. Install in the root, `server`, `web` and `widget`.
2. **Apply the migrations to an empty database.** This is a separate step on purpose, so
   a migration that does not apply cleanly fails the run with an obvious name before any
   test runs.
3. Typecheck all three packages.
4. Widget tests, then the widget build, which fails if the bundle goes over 15 KB gzipped.
5. Web tests, then server tests.
6. Install chromium and run the end-to-end test.

The Postgres service is published on **55432**, because that is what
`server/test/global-setup.ts` expects. `TEST_DATABASE_URL` overrides it if needed.

### Container

One image carries the API and the workers. It builds **from the repository root**,
because the widget lives outside `server/` and the API serves its bundle:

```
docker build -f server/Dockerfile .
```

The build bundles the widget into `server/public/widget/v1/insureongo.js` before
building the server, so `GET /widget/v1/insureongo.js` has something to serve. Building
with `server/` as the context, as it was before, produces an image whose widget route
returns a 500.

`docker-compose.yml` does the same for local work and adds a Redis service.

### Health check

`GET /health` runs `select 1`. 200 `{"status":"ok","database":"up"}` when the database
answers, 503 when it does not, so a load balancer stops sending traffic to an instance
that cannot serve it. Covered in [`test/health.test.ts`](../test/health.test.ts).

### Error reporting

[`src/lib/errors.ts`](../src/lib/errors.ts) initialises Sentry only when `SENTRY_DSN` is
set, and is inert otherwise, so development and tests need no DSN. Tracing is off:
sampled request bodies would carry customer details. Reported today: unhandled request
errors, and any event that gives up after 10 issuance attempts.

### Environment

| Variable | Needed | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ENCRYPTION_KEY` | yes | 32 bytes, base64. Decrypts webhook secrets. The app refuses to start without a valid one |
| `DEFAULT_COMMISSION_RATE` | yes | Rate given to a new store |
| `REDIS_URL` | no | Defaults to `redis://127.0.0.1:6379` |
| `REDIS_PREFIX` | no | Namespaces the queue keys, so one Redis can carry several environments |
| `PORT` | yes in production | Without it Node picks a random port |
| `ADMIN_API_KEY` | yes | Guards the admin endpoints |
| `TRUST_PROXY` | behind a proxy | Which proxies to believe for the visitor's address |
| `SENTRY_DSN` | no | Turns error reporting on |

### Migrations

`npm run db:migrate --prefix server` applies them; `npm run db:generate` creates a new
one. Run migrations as **their own task before the new version takes traffic**, never on
container start: every instance booting at once would run them in parallel. Nothing in
the image does this for you.

## Not done: needs an AWS account and a Sentry project

None of the following could be set up from here, because it needs credentials and an
account. The application side is ready for all of it.

- **ECS Fargate service** for the one image, with **RDS** PostgreSQL and **ElastiCache**
  Redis. Point `DATABASE_URL` and `REDIS_URL` at them.
- **Secrets Manager** entries for `ENCRYPTION_KEY`, `DATABASE_URL` and `REDIS_URL`,
  passed to the task as environment variables. Production needs its **own**
  `ENCRYPTION_KEY`, backed up somewhere safe: lose it and every stored webhook secret
  is unreadable, and no store's webhooks can be verified again.
- **A migration task** in the deploy, run to completion before the new task set takes
  traffic.
- **A deploy workflow.** Deliberately not written: a workflow naming cluster, service
  and role ARNs that do not exist yet would look finished and fail on first use.
- **CloudWatch** for logs, and a **Sentry** project for the DSN.
- **Alerts**, none of which exist yet:
  - the `issuance` queue backing up,
  - any `webhook_events` row reaching `status = 'failed'`,
  - the weekly bill not running on a Friday. Worth alerting on the absence of a new
    `settlements` row rather than on the job, since a job that runs and bills nothing
    looks identical to one that never ran.
