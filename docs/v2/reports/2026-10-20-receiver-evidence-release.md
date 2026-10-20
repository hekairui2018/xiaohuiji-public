# Receiver evidence and collection records — release validation

## Behavior

Receiver-side source normalization, display, journal, retry and two-table writer changes preserve receiver-model candidates, version-suffix evidence and explicit HDSet write reports. Standalone sender models remain separate from device serials. Names such as `R5S Plus` and `R500 Green` retain their original spelling.

A unique model inferred from the helper's version-suffix table is labeled as a table match, not a direct hardware-model reading. Shared suffixes remain ambiguous, and a firmware directory cannot select a candidate. The receiver does not build its own suffix mapping.

New structured per-card observations can create a collection record with a pending outcome. This does not relax strict upgrade-readback/no-upgrade verification, fabricate an exception or mark the customer issue resolved. Missing ports, conflicting identities and aggregate-only completion do not establish per-card results. Existing archives are not automatically migrated under the new admission rule.

The existing task identity, event sequence, upload/authentication routes, date handling, idempotent retry, independent field baselines, human clears and remarks protection remain. Complete candidates/evidence and write reports survive snapshots, details, immutable events and full task TXT. Upload timestamps/transport feedback do not trigger business sync. Stable row search recovers an ambiguous remote write without creating a duplicate.

## Validation

38 receiver-focused checks passed, including synthetic HTTP ingestion through durable storage/outbox and the two-table API contract. All remote table operations in these tests use an isolated in-memory API. Test row IDs and suffix candidates are synthetic and are not claims about production records or a redefinition of the company mapping table.

Coverage includes sender families, spaced models, unique/ambiguous/unknown model evidence, multiple ports sharing a card number, conflicting firmware provenance, explicit failures, unfinished/finished write reports, actual readback, no-upgrade comparison, aggregate-only completion, late/retired runs, duplicates, response loss, restart recovery, manual edits/clears, legacy baselines and absent optional fields.

The existing V2 receiver and its read-only index were restarted. Post-restart checks confirmed collectionPolicy=2, configured two-table sync, pending=0 and no sync error. Local resource pages, index health and the existing public resource entry returned HTTP 200. Unauthenticated upload remained HTTP 403. The watchdog resumed its normal check.

The first restart attempt observed an index that had already exited with its parent and rolled back. The process-exit check was corrected; the subsequent restart and health checks succeeded. No original documents, production table schema, permissions or historical records were changed.

No synthetic task was submitted to production Feishu. A real new-helper task still needs production end-to-end verification; this release does not claim a new real row ID or a verified device upgrade. Historical incomplete tasks require individual evidence review and were not bulk rewritten.

Frontend/product/video work, model inference changes and other assistant projects are outside this release. Source sync includes only the receiver implementation, synthetic tests and this sanitized report.
