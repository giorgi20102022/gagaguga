# Wizard DOM crash investigation

The report describes **one occurrence on step 4 in Android Chrome, followed by a successful retry**. There is no evidence of a recurring production issue. Both active dashboards use the same five screens; displayed step 4 is `Step3Product`, and `Step4Finalize` is displayed step 5. The separate `ხელმოწერა` project is not imported by either active dashboard and was not changed.

## Evidence and cause assessment

A controlled browser test reproduces the exact reported exception using the original `Step3Product` from commit `6fc8301`. The test replaces the verification button's bare text with a `<font>` element, simulating a translator displacing React's text node, then clicks Verify. Switching Search to Loader2 inserts the new icon before the detached text node:

```text
NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
insertBefore -> insertOrAppendPlacementNode -> commitPlacement
Component stack: LoaderCircle -> button -> Button -> MotionComponent
                 -> Step3ProductInner -> ErrorBoundary
```

The patched component survives the same injection without DOM errors. Full stacks and component stacks are in `output/wizard-dom/translation-evidence.json`. This confirms a translation-sensitive rendering defect in the original code, **not that translation caused the reported Android incident**. No production stack, browser build, translation setting, or device session was provided. Normal mocked navigation did not reproduce the exception. The mechanism is consistent with [React's upstream translation issue](https://github.com/react/react/issues/11538).

The earlier `dd12e9a` change wrapped the two `Step2DealerPersonalId` verification-button labels in stable spans. Those wrappers remain intact and survive the translation simulation. Some pre-existing comments blamed nested AnimatePresence updates for insertBefore; those comments are not evidence. No independent animation-only crash was established.

## Reviewed components and findings

| Area | Review and changes |
| --- | --- |
| `Dashboard`, `DealerDashboard` | Reviewed all five step branches, stable step keys, navigation validation, persistence, submission guards and status UI. Removed the boundary retry callbacks that erased the whole draft and returned to step 1. The existing boundary now remounts only the failed subtree; parent draft, step, in-flight guard, application ID and pending status remain owned by the dashboard. |
| `Step1Identity` | Reviewed ID/passport switching, upload counters, request controllers, photo snapshot checks, auto-advance, messages and error dialog. Existing keyed messages, targeted photo reset and navigation protections retained. No production changes needed. |
| `Step2DealerPersonalId` | Retained earlier label spans. Added distinct stable keys to checking/success/already-used/error presence children and exit-presence cancellation. Previously all these mutually exclusive children used the same implicit presence identity. No random keys introduced. |
| `Step2Profile` | Reviewed both supporting-document toggles, independent abort/reset counters, verification buttons and dialog. Guarded asynchronous signature generation against duplicate clicks, changed names/ID, exit and unmount so a late font load cannot update the abandoned draft or advance it. |
| `Step3Product` | Wrapped verification labels/messages, price and subsidy text adjacent to elements. Added a synchronous request guard and code snapshot/request identity checks. Editing a code invalidates the old result; late responses cannot verify the replacement code. Product fetch and verification results ignore exiting/unmounted steps. Continue is blocked during verification. Product IDs remain list keys. |
| `Step4Finalize`, signature preview | Reviewed receipt verification, SMS, city picker, summary, cancel/final actions and signature canvas. Added local text wrappers, presence guards and SMS duplicate/phone-snapshot guards. Receipt and signature behavior remain unchanged; stale SMS replies cannot verify a different phone. |
| `StepIndicator` | Wrapped the numeric alternative to the completed icon so translation cannot turn the number into a detached text sibling during navigation. Step numbers remain stable keys. |
| `MediaUploadZone`, `useMediaUpload` | Reviewed file selection, same-file retry, preview/removal, busy overlay, camera portal, stream cleanup and async preparation. Added wrappers for icon-adjacent labels, native disabled state for the camera action, a capture-generation guard for delayed canvas export, and a mounted-entry check in the upload hook. Removed `h-full` from the preview container: responsive tests confirmed it made the receipt preview overflow into the summary and intercept clicks on mobile. |
| Shared UI | Reviewed `Button`/Slot, inputs, labels, switch/checkbox, `DocumentValidationDialog`, dialog/alert-dialog portals, popover/command, toast/toaster, Navbar and ErrorBoundary. No generic child-rewriting wrapper, DOM prototype patch, translation disablement or exception suppression was added. Existing boundary logging still records error/component stacks. |

Direct DOM operations in these paths are canvas drawing, stream properties, file-input clearing, focus/scroll and camera styling. No application code was found inserting, removing or replacing React-owned DOM children. The test-only translator deliberately does so to reproduce the defect. Reset-counter keys are intentional and confined to failed photo fields; product/city/step/toast keys are stable.

## Verification

All external application services were mocked locally. No real applications, SMS messages, OCR jobs, portal registrations or webhook deliveries were sent. No deployment or push was performed.

- `npm.cmd run check`: passed.
- `npm.cmd run build:vercel`: local frontend build passed. Existing warnings: large chunks, stale Browserslist data, unresolved `/fonts/DM-Ambrosi-UNI.ttf`. Embedded signature font tests pass; this unrelated CSS font reference was not changed.
- `node --test tests/identity-flow.test.mjs tests/finalization-flow.test.mjs tests/signature-rendering.test.mjs`: 30 passing tests, including parent duplicate guards, ID auto-advance, ID/passport failures and retry, supporting-document and receipt selective reset, timeout/late responses, and distinct `წ`/`ჭ` signature glyphs.
- `$env:TEST_MOBILE='1'; node --test tests/identity-flow.test.mjs`: 26 passing tests with a 393×851 touch/mobile viewport, including both dashboards' navigation handlers and the real shared upload/document components.
- `npm.cmd run test:wizard-dom`: real responsive CSS and Chromium, 1440×1000 desktop and 393×851 mobile emulation. Covers both real dashboard components, all five screens, forward/back navigation, lookup and product error/success retry, translated loader transitions, image upload/removal/same-file retry, receipt error-dialog opening/closing, SMS success, deliberate render failure and recovery. Recovery preserves unrelated data and never submits automatically. Recovery during a held mocked submission keeps actions disabled; repeated clicks produce exactly one outgoing local submission request. Dealer submission-error modal opens/closes and preserves the draft.
- Focused tests cover baseline versus patched translation injection, replaced-code responses, duplicate verification clicks, unmounted completions, stale SMS replies, expiry immediately before/after the **30-minute** bypass deadline, font completion after Back, and camera export after close.
- `git diff --check`: passed. Screenshots of recovered desktop/mobile dashboards and stack evidence are in `output/wizard-dom/`.

The dynamic abbreviated signature implementation and Unicode glyph mapping were not modified. Photo failure handling still clears only the failed document and its derived verification, and successful identity verification still automatically advances once. Submission IDs, queue tracking and server idempotency logic were not changed.

## Limits

Mobile tests use desktop Chromium emulation, not a physical Android device. Translation is a deterministic DOM-mutation simulation, not the live Chrome translation service. Camera tests use a synthetic stream and delayed export, not hardware/OS permissions; HEIC decoding and real network integrations were not exercised. These tests establish concrete local behavior but cannot prove the cause of the single reported incident or eliminate every possible extension/translator mutation. No production telemetry was available.
