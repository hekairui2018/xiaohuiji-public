'use strict';
const crypto = require('node:crypto');
const { normalizeModel } = require("./model-identity.cjs");
function sourceIdentity(record, sourceFile = record.sourceFile || '') {
  const s = record.source || {};
  const locator = s.locator || [s.worksheet, s.row, s.slideStart, s.slideEnd].filter(x => x !== undefined && x !== null).join(':');
  if (!sourceFile || (record.sourceFile ? !record.originalId : !record.id)) return null;
  const raw = JSON.stringify([sourceFile, String(record.originalId || record.id), String(locator)]);
  return 'SRC-' + crypto.createHash('sha256').update(raw).digest('hex');
}
function buildIndex({ products = [], specs = [], cases = [], firmware = [], devices = [] }) {
  const index = { schemaVersion: 1, policy: 'Derived only; ambiguous aliases and source identities remain arrays, never choose silently.', models: {}, aliases: {}, provenance: {}, issues: { ambiguousAliases: [], duplicateSources: [], missingSources: [] } };
  const register = (name, kind, reference, aliases = []) => {
    let model = normalizeModel(name);
    if (!model) return;
    if (!['productRows', 'specRows'].includes(kind) && index.aliases[model]?.length === 1) model = index.aliases[model][0];
    const entry = index.models[model] ||= { productRows: [], specRows: [], caseIds: [], firmwareFiles: [], orderingRows: [] };
    if (!entry[kind].includes(reference)) entry[kind].push(reference);
    for (const raw of [name, ...aliases]) {
      const alias = normalizeModel(raw); if (!alias) continue;
      const owners = index.aliases[alias] ||= [];
      if (!owners.includes(model)) owners.push(model);
    }
  };
  products.forEach((p, i) => register(p.product || p.displayName, 'productRows', i, p.aliases || []));
  specs.forEach((p, i) => register(p.product || p.displayName, 'specRows', i, p.aliases || []));
  cases.forEach(c => {
    for (const model of c.products || []) register(model, 'caseIds', c.id);
    const identity = sourceIdentity(c);
    if (!identity) index.issues.missingSources.push(c.id);
    else (index.provenance[identity] ||= []).push({ caseId: c.id, sourceFile: c.sourceFile, originalId: c.originalId, locator: c.source?.locator || '' });
  });
  firmware.forEach(f => register(f.card, 'firmwareFiles', f.file));
  devices.forEach((d, i) => register(d.name || d.model, 'orderingRows', i));
  for (const [alias, owners] of Object.entries(index.aliases)) if (owners.length > 1) index.issues.ambiguousAliases.push({ alias, owners });
  for (const [identity, rows] of Object.entries(index.provenance)) if (rows.length > 1) index.issues.duplicateSources.push({ identity, caseIds: rows.map(r => r.caseId) });
  return index;
}
module.exports = { normalizeModel, sourceIdentity, buildIndex };
