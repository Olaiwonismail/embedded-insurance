# Policy issuance worker: two fixed issues

The worker in [`src/lib/issuance/worker.ts`](../src/lib/issuance/worker.ts) turns saved paid-order webhooks into policies. The first version had two weak spots. This page says what each one was, how it is fixed now, and what is still open.

---

## Issue 1: failed events were only retried when a new webhook came in

### What was wrong
The webhook receiver starts the worker after it saves an event. If the insureOnGo call failed, the event stayed `received`, and nothing ran the worker again until some other webhook arrived. On a quiet store, a paid order could sit without a policy for hours.

A first fix ran the worker on a 30-second timer. That cured the delay but retried a failing event forever, so a permanently broken order was retried every 30 seconds with no end.

### The fix
Issuance is a BullMQ queue on Redis ([`src/lib/queue/issuance.ts`](../src/lib/queue/issuance.ts)). The timer is gone.

- The receiver adds one job per newly saved event, using the `webhook_events` row id as the job id, so the same event can never be queued twice. A repeated webhook inserts no row, so it queues nothing.
- Up to **10 attempts**, waiting longer each time, starting at **1 minute** (`MAX_ATTEMPTS`, `FIRST_BACKOFF_MS`).
- After the last failed attempt the event is marked `failed` with the reason in `error`, for example `gave up after 10 tries: Error`.
- Up to **5 jobs at once** (`CONCURRENCY`). The existing `pending` policy claim on `issuanceKey` already stops two workers issuing the same order.
- A sweep every **10 minutes** queues any paid-order event still `received` after **5 minutes**, covering a job that was never added or was lost. The job id makes this safe to run as often as we like.

Schedules live in [`src/lib/queue/schedules.ts`](../src/lib/queue/schedules.ts), the only file that knows when things run. The weekly bill (Friday 08:00) and the quote cleanup (daily 03:00) are scheduled there too, both on `Africa/Lagos`. The job functions themselves take no interest in queues or clocks.

Redis comes from `REDIS_URL`. `REDIS_PREFIX` namespaces the keys so one Redis can carry more than one environment.

### Still open
- **Nothing watches the `failed` pile.** An event that gives up after 10 tries needs someone to look. Alerting on it is part of the monitoring work.

---

## Issue 2: a database transaction stayed open during the insureOnGo call

### What was wrong
Each event was handled in a single transaction, and the insureOnGo call happened inside it. While insureOnGo was answering, which could take seconds:

- the event row and the quote row stayed locked,
- one database connection was tied up in an open transaction,
- if insureOnGo hung, all of that was held for as long as it hung.

### The fix
The work is now split into three steps. Only steps 1 and 3 use a transaction, and both are short.

| Step | Transaction? | What it does |
|---|---|---|
| 1. Reserve | yes | Checks the order and quote, saves the customer, and inserts the policy with `status = pending`. The unique `issuanceKey` (`storeId:orderRef:quoteId`) claims the order, so no other run can issue it. Commit. |
| 2. Call insureOnGo | **no** | `client.issuePolicy(...)`. No row locks are held. |
| 3. Activate | yes | Policy to `active` with its number and dates, quote to `accepted`, event to `processed`. All three together or none. |

What happens when something goes wrong:

- **insureOnGo throws:** the pending policy is deleted and the event stays `received`. The next run starts again from step 1.
- **The process dies between step 1 and step 3:** the pending policy is still there. The next run finds it by `issuanceKey` and goes straight to step 2 with the saved customer. It does not create a second policy.
- **A second order for the same quote while the first is pending:** the quote is still `offered`, so step 1 also checks for any policy on that quote. The second order fails with `quote N is already used by another order`.

No schema change was needed. `policies.status` already allows `pending`, and `policyNumber`, `startsAt` and `endsAt` can be empty until step 3.

### Still open: insureOnGo must treat repeats as one policy
There is one case the database alone can't cover. If insureOnGo issues the policy but our process dies before step 3, the retry calls insureOnGo a second time for the same order. The same can happen if two server processes pick up the same pending policy at once.

To stop insureOnGo issuing two real policies, the call now sends `issuanceKey`, which is the same value on every try for the same order (`InsureongoPolicyInput.issuanceKey` in [`src/lib/insureongo.ts`](../src/lib/insureongo.ts)). The real client has to pass it to insureOnGo so that a repeat returns the first policy instead of making a new one. This is often called an idempotency key.

**Action:** when the real insureOnGo client is built, ask insureOnGo whether their issue-policy API accepts a key like this, and how. If it doesn't, a crash at the wrong moment can still issue a policy twice. Someone would then need to catch it by hand, for example by checking for any policy left `pending` for more than a few minutes.

---

## Tests

Queue behaviour, against a real Redis, in [`test/queue.test.ts`](../test/queue.test.ts):

- `adds one job per saved event and refuses a duplicate`
- `issues one policy when insureOnGo fails three times then succeeds`
- `tries ten times then marks the event failed with a reason`
- `queues an event left received with no job` and `leaves a freshly received event alone`
- `registers the weekly bill, the cleanup and the sweep on Lagos time`

Issuance behaviour in [`test/issuance.test.ts`](../test/issuance.test.ts):

- `holds no transaction or row locks while insureOnGo is called`: inside the insureOnGo call, it locks the quote and event rows from another connection with `NOWAIT` (which errors at once if a lock is held), and checks that the pending policy is already visible.
- `picks up a pending policy left by a crash and finishes it`
- `fails a second order for a quote that already has a pending policy`
- `leaves the event received when insureOnGo throws, then issues on the next run`
