# V2 receiver three-cell display

The leadership table uses a concise projection while retaining the original source-aware snapshot, detailed evidence and full task TXT.

- Product model: sender plus receiver totals by model, e.g. `A6L＋R712×8＋R708×4`.
- Version information: groups by model, before/after version and outcome; e.g. `R712：25.1 → 25.9 ×5`, `R712：25.2 → 25.9 ×3`, `R708：26.1 → 26.9 ×4`.
- Environment: groups unique cards by port and model, e.g. `网口1：R712×5`, `网口2：R712×3、R708×4`. Existing explicit software/chip fields remain.

Parenthetical provenance, suffix-table names, inference versions, candidate lists and firmware-directory associations do not appear in these three cells. Uncertain models remain uncertain. In-depth evidence stays in existing internal details and TXT. Sender device/application/FPGA information remains in the version cell.

Write-report outcomes remain separate from readback, failure and pending outcomes, even when numeric versions match. The report version is explicitly labeled `报告写入成功，未回读`; an absent report version is never filled from the target version. Missing identities, conflicts and unknown inventory counts do not fabricate quantities or confirmed transitions. Duplicate inventory without per-card identities is not silently added.

The existing shared legacy display builder and hardware evidence rules are retained. V2 uses the new `buildV2Display` projection; its writer no longer appends a second verbose outcome paragraph. Human edits, cleared cells, legacy baselines and independent automatic suggestions remain protected.

41 focused checks passed, including the synthetic HTTP-to-table contract and new quantity/port/version-group fixtures. Table writes in these tests are isolated in-memory calls. No real row was changed and no receiver was restarted for this presentation-only follow-up. Existing rows are not automatically rewritten, and source sync does not imply deployment.

The helper must supply `write_reported_status`, `write_reported_version`, `write_reported_finished` and `write_reported_source` after parsing a real HDSet write result. The receiver supports these fields but does not infer them from a target firmware or parse customer log prose into a per-card success claim. `after_confirmed` remains false until actual readback.
