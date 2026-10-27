# GrayDesk standard update server

Implemented the exact case-sensitive manifest contract already supported by GrayDesk, with a separate standard/win-x64 route, same-origin HTTPS download URLs, anonymous read access and authenticated loopback-only administration. Existing firmware-assistant update protocol remains separate.

The user-supplied ordinary installer was independently hashed and sized, copied into immutable candidate storage and kept unpublished. No client source, installed application, customer machine or GitHub binary release was modified. Package registration is a local file workflow; no browser upload UI or remote publishing endpoint was introduced.

Seven update test groups plus 13 existing error-receiver/LAN/public checks passed (20 total). These cover exact manifest, UTF-8 names, byte-identical download, size/hash, HEAD, Range, ETag, authentication, interrupted copy, atomic concurrent registration/publication, channel separation and missing/corrupt storage. A separate isolated test downloaded the entire real installer (96,578,982 bytes) and matched its expected SHA256. These do not constitute installer execution or real client HTTPS acceptance.

Development service deployment retained rollback copies, drained active business and preserved existing configuration. Empty production manifest returns 404; unauthenticated local administration returns 401; existing firmware-assistant manifest remains 200. Public HTTP GrayDesk updates return 426 and public administration remains forbidden.

HTTPS infrastructure remains unavailable: the current public endpoint closes TLS connections under normal validation. No usable production HTTPS URL or connected GrayDesk client is claimed delivered. A real HTTPS origin, explicit package-publication authorization and endpoint/client acceptance remain outstanding. See `docs/v2/GRAYDESK_UPDATES.md`.
