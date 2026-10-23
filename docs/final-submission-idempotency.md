# Final submission investigation and recovery

## Follow-up verification of the local patch

The initial tests below did **not** establish the full frontend-to-webhook behavior: the parent-handler tests stopped during preparation, and the HTTP-route tests replaced `axios.post`. A subsequent test, `tests/finalization-recording.test.ts`, mounts both full dashboards and exercises their actual components, submission hooks, multipart uploads, authenticated Express routes, finalization service, pacing queue, and Axios HTTP delivery to a **local recording webhook**.

The test adds only browser access to the existing state setters and actual parent handler, allowing a synthetic verified application to start at the final step and a retained callback to be invoked deliberately. Authentication uses locally signed test dealer/SMS cookies. PostgreSQL queries and dealer/product storage are explicitly simulated. Outbound server Axios requests are restricted to the loopback recorder, and browser requests outside the local app origin are blocked. No production n8n, SMS, portal, or Sheets service is contacted.

**A real remaining duplicate path was reproduced in both dashboards before the follow-up fix:** after the frontend observes success, it removes the session application ID. Deliberately invoking the retained original `handleSubmit` again uses the old completed form data but allocates a new ID. The recorder received **two application requests and zero `action: cancel` requests** for that original application. The failing assertions and recorded IDs are summarized in `finalization-reproduced-duplicate.json`. This proves the local retained-callback failure; it does not establish that such a callback caused the original production incident.

The follow-up fix in both dashboard `handleSubmit` methods rejects callbacks whose form snapshot has been replaced or completed. Completion is marked synchronously before retiring the session ID; workspace polling marks completion too. New draft objects can still submit. The immediate in-flight guard and server idempotency remain in place. No SMS, photo-reset, pricing, or navigation behavior was changed by this follow-up fix.

Run `node --import tsx --test tests/finalization-recording.test.ts` to regenerate `finalization-recording-results.json`. It counts actual recorder requests separately from cancellations. Each dashboard's scenarios reuse one application through double-clicks, concurrent callbacks, eight concurrent requests across both endpoints, a delayed response/client timeout/retry, completed replay, and a late original callback; then a genuinely new application is submitted with twenty concurrent handler calls. The new application's count is reported cumulatively (2 means one original plus one genuinely new application).

The recording test holds the webhook response and advances Chromium's clock to fire the existing 40-second/120-second client abort timers; it does not replace those timers or submission functions. Server time, actual outbound HTTP and the 60-second pacing run normally. This exercises a client timeout while delivery is outstanding; an actual 120-second Axios downstream timeout is still covered only by the separate simulated failure test, not by this recording run.

The post-fix recording run passed in 183 seconds. Actual cumulative deliveries for each dashboard were:

| Scenario | Dashboard applications | Workspace applications | Cancellations (each) |
| --- | ---: | ---: | ---: |
| Rapid double-click | 1 | 1 | 0 |
| 20 concurrent calls to the pending handler | 1 | 1 | 0 |
| 8 concurrent HTTP requests across both endpoints | 1 | 1 | 0 |
| Client timeout, then retry while webhook reply is held | 1 | 1 | 0 |
| Completed retry through the other endpoint | 1 | 1 | 0 |
| Late original handler after frontend success | 1 | 1 | 0 |
| Genuinely new application, with 20 concurrent handler calls | 2 | 2 | 0 |

The last row means **one additional delivery for a new application**, not a duplicate of the first. The full run recorded four application HTTP requests total, with four distinct IDs, and zero cancellations. `finalization-recording-results.json` contains the measured scenario results and IDs. TypeScript and `git diff --check` passed. The regression suite passed 41 tests (including SMS expiry, photo resets and automatic advancement) and explicitly skipped one real-PostgreSQL test; the recording integration test is an additional pass.

**PostgreSQL verification is blocked:** no disposable database URL, PostgreSQL binaries, or Docker installation were available. The real database test explicitly skips without `TEST_FINALIZATION_DATABASE_URL`. The recorder verifies real HTTP dispatch counts under the simulated database boundary; it does not prove PostgreSQL contention, durability across process restarts, or deployment behavior. Live n8n/Sheets behavior also remains unverified and was intentionally untouched.

## Evidence and confirmed code paths

Baseline inspected: commit `37656ee` (before this patch). No production n8n executions or Sheets data were available, so the particular observed duplicate rows cannot be attributed conclusively.

- Both dashboards render the same `Step4Finalize`. Its button is `type="button"`, prevents default/propagation, and calls `handleFinish` -> `onSubmit` once. There is no final form-submit binding. Previously `handleFinish` (baseline `client/src/components/wizard/Step4Finalize.tsx:464`) and both parent `handleSubmit` handlers (`Dashboard.tsx:111`, `dealer/DealerDashboard.tsx:392`) lacked synchronous guards. Loading state alone did not exclude re-entry before a render or repeated callback invocation.
- SMS success (`Step4Finalize.tsx:286`) only sets `smsVerified`. Bypass affects validation; neither calls `onSubmit`. Signature callbacks update data, not finalization. Identity advancement calls `nextStep`, with a step equality check, and never calls finalization. The latest identity/photo/SMS-expiry changes do not establish an automatic duplicate-submit path. Existing regression tests cover these changes.
- `/api/submission/submit` (baseline `server/routes.ts:1641`) queued every request without an application ID and returned success before n8n completed. `/api/workspace/submit` generated a fresh UUID for **each attempt** (baseline `server/routes.ts:1995`), so retries could not be recognized.
- The confirmed extra-delivery path was `handleSubmission` / `processRetryQueue` -> `executeWebhookSubmission`, followed on failure by `cancelWebhookSubmission`, which POSTed to the **same final webhook** with `action: cancel`. The failure branch and catch could both cancel (baseline `server/routes.ts:349-455`). The workspace timeout/error handler could send another cancellation (`server/routes.ts:2141`). A timeout did not prove n8n had stopped or rolled back. This produces extra incoming webhook executions; whether those cancellation executions append rows depends on the n8n workflow.
- The queue did not retry a dispatched final payload automatically. It delayed distinct requests; because there was no durable identity/claim, repeated requests became separate queued deliveries. The legacy client aborts after 40 seconds, workspace after 120 seconds, while server dispatch could continue. A manual retry therefore could duplicate an already delivered submission.
- The exported browser `submitToN8N` / `cancelSubmission` helpers had no callers; removed to eliminate an unguarded alternative final-webhook path. `lib/api.ts` retries stove-code operations through `/api/check-stove-code`; it does not call the final webhook. OCR, pensioner, personal-number portal, and receipt webhooks are separate from final delivery.

## Implemented behavior

Both endpoints validate dealer authentication, current SMS proof/bypass, schema, and receipt before entering the same `FinalizationService`. Pricing/subsidy eligibility, ownership checks, photo reset and automatic navigation logic remain separate.

The browser retains a random application UUID in **sessionStorage**, scoped to the dealer and current tab. Both dashboards use it; retries, navigation and reloads reuse it. Successful completion retires it. Independent tabs and subsequent completed applications obtain distinct IDs, even for the same beneficiary. An unresolved application retains its ID even if the visible wizard is reset. Storage failures stop submission rather than silently issuing unpersisted IDs. Clearing browser storage or closing an unrecoverable tab loses this correlation; operators must recover the logged submission ID instead of recreating an uncertain application.

Immediate refs guard the shared final component and both dashboard handlers. The component awaits the parent promise, and existing disabled/loading controls remain. No React StrictMode assumption is involved.

`final_submissions.submission_id` is a PostgreSQL primary key. `INSERT ... ON CONFLICT DO NOTHING RETURNING` atomically grants a single processing claim, across both endpoints and all server instances. No personal-number or time-window deduplication is used. There is no memory fallback, automatic claim expiration, or automatic resend.

- Completed duplicate: HTTP 200 with the stored safe result.
- Processing duplicate: HTTP 202, `SUBMISSION_IN_PROGRESS`, stable ID; workspace polls the authenticated status route. The legacy dashboard reports processing instead of claiming success; checking again uses the same ID.
- Uncertain delivery: HTTP 409, `SUBMISSION_UNCERTAIN`, stable ID and reconciliation message. Timeouts, transport failures, unrecognized/rejected replies, or ambiguous downstream outcomes never send an automatic cancellation or retry.
- Success requires a successful HTTP response and recognized business acknowledgement (explicit `success: true` or the previously accepted Georgian success/RDA messages), without explicit failure flags. The n8n acknowledgement contract below must hold. Successful final delivery is recorded before the separate oven-code update; an oven-code failure logs a reconciliation requirement and cannot replay the final webhook.
- A processing record older than ten minutes is shown as uncertain, **without reclaiming it**. The original process may still be queued/running. A process crash or DB failure after delivery leaves a blocking claim, not permission to resend.

Distinct submissions retain the prior per-process 60-second pacing. This is not a durable queue or a global cross-process Sheets lock. A queued request lost on process shutdown needs operator reconciliation. Durable per-ID claims prevent duplicate dispatch, but do not guarantee eventual delivery.

Logs include submission ID, request ID, endpoint, dispatch attempt and outcome, including actual `dispatch_started`. They exclude submitted documents, credentials, personal fields and downstream response/error objects. The webhook receives `submissionId`, `submission_id`, and `Idempotency-Key`, plus diagnostic request metadata.

## Database change (not applied)

Apply `migrations/20261023_final_submission_idempotency.sql` before serving the updated application. It creates the delivery ledger and dealer foreign key; `db-init.ts` also includes this creation for environments using startup initialization. Drizzle schema is updated. Do not expire or delete ledger rows: doing so permits replay. No existing submissions/duplicate rows are deleted or rewritten. Old cached clients without a UUID fail validation and must reload.

## Required n8n changes and reconciliation

These are required for reliable downstream recovery; **this patch does not claim end-to-end exactly-once Sheets writes** and does not change n8n remotely.

1. At webhook entry, require a UUID `submission_id` matching `Idempotency-Key`. Preserve it through every branch and subworkflow. Treat `action: cancel` as a separate explicit operation, never as a new application or append operation.
2. Before side effects, atomically insert that ID into a durable PostgreSQL inbox with a unique primary key, state, n8n execution ID, result, and Sheets row reference. Use `INSERT ... ON CONFLICT DO NOTHING RETURNING submission_id`. Only a returned row may execute side effects. A SELECT followed by INSERT, n8n workflow static data, and a Sheets lookup followed by append are not concurrency-safe claims.
3. A duplicate inbox ID must return its stored terminal result, or an explicit in-progress/reconciliation response, without repeating side effects. Do not enable workflow/node retries that bypass this gate.
4. Add a `submission_id` column to Sheets and write it on every application row. Persist the resulting row reference in the inbox. Sheets does not provide a unique constraint: an append timeout/crash between writing Sheets and updating the inbox must stay unresolved. Stop/fence the original execution before recovery; inspect Sheets by ID and reconcile the existing row. Do not blindly retry append, including via an automatic node retry. For automatic recovery, implement a serialized writer with durable per-ID row allocation and idempotent updates to that same row; ambiguous allocation/write outcomes must still be reconciled.
5. Configure Respond to Webhook to return `success: true` only after the final workflow effects are confirmed and its inbox result is committed. A generic immediate HTTP 200/accepted response is not confirmation. Preserve explicit accepted RDA outcomes only if they actually represent the workflow's intended terminal success.
6. Provide an authenticated read-only status lookup by submission ID, or have an operator inspect the durable inbox/execution/Sheets row. For an uncertain application, determine whether the original execution is still active; **do not reset the app claim while it may run**. If delivery is confirmed, an operator can update that app ledger row to `completed` with the same safe result shape (`success`, `submissionId`, `message`). If absence of all side effects is proven and the old execution is stopped, replay only under a controlled recovery process using the **same ID** and the downstream gate. No automatic replay/reconciliation endpoint is included here. Repair oven-code side effects independently of final delivery.

## Verification

- `npm.cmd run check`: passed.
- `node --import tsx --test server/finalization.test.ts server/finalizationRoutes.test.ts server/smsSubmission.test.ts server/smsBypass.test.ts`: 12 passed. Real HTTP routes are exercised with controlled PostgreSQL and webhook boundaries. Tests cover concurrent cross-endpoint calls, SMS bypass/proof, ownership, completed retries, uncertain delivery, completion-write failure, crash state, distinct IDs for one beneficiary, and oven-update failure.
- `node --test tests/finalization-flow.test.mjs`: 3 passed. Actual shared React final component, SMS/bypass flows, rapid clicks, ID persistence/new application lifecycle, and both actual parent handlers.
- `node --test tests/identity-flow.test.mjs`: 26 passed, preserving identity advancement, back navigation, stale-response rejection and document/photo resets in both dashboards.
- `server/finalizationPostgres.test.ts` is opt-in with `TEST_FINALIZATION_DATABASE_URL` pointing to a disposable PostgreSQL test database. It creates/drops a unique isolated schema and tests independent pools/connections and persistence after reconnect. It never uses `DATABASE_URL`. No test database was supplied here, so real PostgreSQL contention and live n8n/Sheets behavior remain unverified.

No deployment, push, production migration, or duplicate-record deletion was performed.
