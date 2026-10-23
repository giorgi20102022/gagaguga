# Georgian signature rendering investigation

## Confirmed local cause

Both `signatureUtils.ts` and `Step4Finalize.tsx` previously encoded `წ` (U+10EC) as ASCII `W`, and `ჭ` (U+10ED) as ASCII `w`, before painting with GeoElguja. Visual inspection of the actual embedded font shows the reverse glyph assignment: `w` draws **წ**, `W` draws **ჭ**. The font has no Unicode mappings at U+10EC/U+10ED. It is a legacy ASCII-encoded Georgian typeface, not a Unicode typeface.

The confirmed name was not changed in form storage. The draw-time text was converted to ASCII, and the incorrect mapping selected the wrong glyph. This is a deterministic local font-encoding bug, not evidence of an AI image generation error. No AI image model is used for the local signature.

## Trace and fix

1. `Step1Identity.tsx` copies extracted `firstName`/`name` and `lastName`/`surname` into form data. Editable confirmation fields write their values directly. No `წ`/`ჭ` substitution was found there. Photo resets invalidate signature data independently.
2. `Step2Profile.tsx` generates the cached signature before navigation. The final step previews it, and both dashboard submission paths send it. Previously there were two duplicate ASCII maps plus an unrelated `DM Ambrosi UNI` workspace fallback with abbreviation, uppercasing and a short font-load timeout.
3. All local paths now use `signatureUtils.ts`. Only the legacy font encoding is corrected (`წ -> w`, `ჭ -> W`). There is **no global replacement of Georgian characters**. Stored first/last names remain unchanged, including case and whitespace. The generated signature dynamically renders the current confirmed first name's first Unicode character, followed by ". " and the complete confirmed surname. Only the signature is abbreviated; stored and submitted name fields retain their full values. No name is hardcoded.
4. The font is explicitly loaded with `FontFace` before rendering. Failure does not silently draw encoded ASCII using another font. Non-Georgian characters use a system Unicode font instead of the legacy font's Georgian-encoded Latin slots. Canvas size follows glyph bounds, avoiding the old fixed 400x80 clipping, and JPEG quality is 0.95 instead of 0.5.
5. The final preview displays the actual rendered canvas, not a second independently encoded text preview. Old asynchronous renders cannot overwrite a newer confirmed name. Both submission paths regenerate from current confirmed names instead of trusting a previously persisted incorrect signature.

## Exact external boundary and PDF limitation

- `use-submission.ts` sends `firstName`, `lastName`, and `signature` through multipart `/api/submission/submit`. `signature` remains **bare JPEG base64**, preserving that endpoint's existing contract.
- `DealerDashboard.tsx` sends the same name fields through `/api/workspace/submit`. Its `signature` remains a **`data:image/jpeg;base64,...` URL**, preserving its existing contract.
- The server parses those fields via `submissionSchema`, includes them with `...input`, and passes them through the shared finalization service to `executeWebhookSubmission`. The target is `SUBMIT_ALL_DATA_WEBHOOK`, falling back to the final n8n webhook ending in `/69083b0e-989b-4fa9-a091-0bd322884e1f`. No name-to-signature transformation or PDF generation exists in this active server path.
- The **external step to inspect is the PDF/template/image-consumption step downstream of that webhook that consumes `body.signature` and/or `body.firstName`/`body.lastName`**. No workflow export or final generated application PDF is present in this repository, so the exact n8n node name, PDF template and production font embedding cannot be inspected or verified here.
- That step must embed the supplied image without regenerating the name, decoding bare base64 vs the data URL consistently. A raster signature does not require a PDF font: its glyphs are pixels. If the external step instead typesets the name again, it must use the exact confirmed Unicode name and embed a Unicode Georgian font with distinct U+10EC/U+10ED glyphs; never apply the legacy ASCII mapping to a Unicode font, swap valid Georgian letters, or ask an image model to spell the name.

## Local verification artifacts

`tests/signature-inspect.mjs` renders the old font's `w`/`W` beside the Unicode Sylfaen reference. `tests/signature-rendering.test.mjs` executes the actual shared renderer for four different confirmed-name pairs, covering წ, ჭ, both letters in one surname, and trailing surname whitespace. It asserts the dynamic initial-plus-surname strings, unchanged input fields, and distinct glyph encodings, then generates real JPEG signatures and a local PDF proof with those images. After restoring abbreviation, this test and TypeScript passed; the regenerated PDF page was visually inspected. Existing duplicate-submission and identity-flow code was not changed by this formatting adjustment.

Artifacts are under `output/pdf/`: `legacy-glyph-comparison.png`, `signature-1.jpg` through `signature-4.jpg`, `signature-proof-browser.png`, `signature-proof.pdf`, and `signature-proof-data.json`. This PDF is explicitly a **local verification document, not the final n8n application PDF**. Production PDF visual verification remains blocked pending that artifact or workflow access; no real applications were sent.

The browser images and the actual PDF page rendered by PyMuPDF (`signature-proof-page-1.png`) were visually inspected. The one-page PDF contains four raster signature images. The reference text fonts (subset Arial and Sylfaen) are embedded, verified by extracting non-empty font programs; GeoElguja is not a PDF font resource because those glyphs are already in the signature pixels. `font-pdf-inspection.json` records the font coverage and embedding checks.

The existing duplicate-submission, SMS expiry, photo reset and automatic advancement regression suite passed all 41 tests after the changes. The signature-rendering test and the full real-dashboard/backend local-recording test also passed. The latter again recorded exactly four deliveries for four distinct applications across both dashboards, with no extra deliveries for retries and no cancellations. Its database boundary remains simulated. TypeScript also passed. No deployment, push, n8n change, or production-data operation was performed.
