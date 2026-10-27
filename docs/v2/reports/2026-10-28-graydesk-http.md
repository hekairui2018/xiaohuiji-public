# GrayDesk HTTP endpoints

The user requested HTTP instead of paid HTTPS and explicitly approved plaintext transmission of the dedicated upload credential and sanitized exceptions after a specific risk prompt. The previously rejected combined deployment was not bypassed: a non-sensitive update-only deployment was completed first; log HTTP activation followed the new explicit approval.

GrayDesk manifest configuration now supports HTTP/HTTPS and the public guard permits the scoped HTTP log/update routes. Authentication, sanitization, deduplication, successful remote-write confirmation, channel isolation and loopback-only administration remain. No client source, client installation, package publication or GitHub binary release was performed.

20 targeted synthetic tests passed. Actual public HTTP synthetic upload returned written, then exists; remote read-back found exactly one sanitized row. Public update manifest returns 404 because no release is published; admin and internal session routes return 403. Development services were restarted after business drain with recovery copies retained. The update package remains an unpublished candidate.

The existing GrayDesk client still enforces HTTPS in both check-source and download-source validation. Its project must implement the user-approved exact-host HTTP exception and ship an updated client; a config edit alone is insufficient. See docs/v2/GRAYDESK_HTTP_HANDOFF.md.
