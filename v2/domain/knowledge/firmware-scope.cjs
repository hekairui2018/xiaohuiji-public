'use strict';
// One authoritative boundary for what may be offered as public firmware.
//
// The SQLite index deliberately keeps every historical .bin so internal
// administration and traceability survive. Only the curated manifest is an
// approval list: a file that is indexed, present on disk and downloadable is
// still not published firmware unless the registry says so.
//
// This module is data-driven (manifest file), never a second copy of the list.
const fs = require('node:fs');

function key(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function rowPath(row) {
  if (!row) return '';
  if (row.path) return row.path;
  const drive = String(row.sourceDrive || '');
  const folders = Array.isArray(row.folders) ? row.folders : [];
  const name = String(row.name || '');
  if (!drive && !folders.length) return name;
  return [drive, ...folders, name].filter(Boolean).join('\\');
}

function isBinary(row) {
  return /\.bin$/i.test(String(row?.name || row?.file || ''));
}

function createFirmwareScope({ manifestFile = null } = {}) {
  const empty = {
    configured: false,
    size: 0,
    items: [],
    bySha: new Map(),
    byName: new Map(),
    has: () => false,
    resolve: () => null,
    dialogueItems: () => [],
    allows: () => true,
    allowsRow: () => true,
    partition: rows => ({ rows, hidden: [] }),
    hidden: () => null,
    hiddenIds: () => [],
  };
  if (!manifestFile || !fs.existsSync(manifestFile)) return empty;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return empty;
  }
  if (!data || data.schemaVersion !== 'xhj-curated-firmware-1' || !Array.isArray(data.items)) return empty;

  const bySha = new Map(), byName = new Map(), byKey = new Map(), items = [];
  for (const item of data.items) {
    if (!item || item.kind !== 'firmware') continue;
    if (!/^[a-f0-9]{64}$/.test(String(item.sha256 || ''))) continue;
    const record = { ...item };
    items.push(record);
    bySha.set(record.sha256, record);
    byName.set(String(record.name || ''), record);
    if (record.path) byKey.set(key(record.path), record);
    if (record.relativePath) byKey.set(key('G:/公网发布资料/' + record.relativePath), record);
  }

  // locationId -> hidden record, rebuilt on every catalog refresh so a stale
  // id from a previous catalog signature cannot stay blocked or stay open.
  let hiddenById = new Map();
  let hiddenRecords = [];

  function allows(row) {
    if (!row) return false;
    if (row.sha256 && bySha.has(row.sha256)) return true;
    const name = String(row.name || row.file || '');
    if (byName.has(name)) {
      const record = byName.get(name);
      // Same name is not the same binary: only trust a name hit when the row
      // carries no content hash at all, and the byte size also agrees.
      if (row.sha256) return record.sha256 === row.sha256;
      if (Number.isFinite(Number(row.sizeBytes)) && Number.isFinite(Number(record.size))) {
        return Number(row.sizeBytes) === Number(record.size);
      }
      return true;
    }
    const candidate = key(rowPath(row));
    return candidate ? byKey.has(candidate) : false;
  }

  const isFirmwareRow = row => row?.resourceType === 'firmware' || isBinary(row);
  function resolve(query) {
    if (!query) return null;
    if (query.sha256) return bySha.get(query.sha256) || null;
    return byName.get(String(query.name || query.file || '')) || byKey.get(key(rowPath(query))) || null;
  }
  function dialogueItems() {
    return items.map(item => {
      const models = (item.deviceModels?.length ? item.deviceModels : item.models || item.hardwareFamilies || []).map(String);
      const url = '/v2/curated-firmware/' + item.sha256 + '/' + encodeURIComponent(item.name);
      return {name:item.name,file:item.name,sha256:item.sha256,models,card:models[0]||null,
        category:item.category,versionNote:item.versionNote||'',firmwareVersion:item.firmwareVersion||null,
        sizeBytes:Number(item.size),url,publicUrl:url,status:'uploaded',compatibilityConfirmed:false,
        verificationStatus:'curated-official-firmware-registry'};
    });
  }

  function partition(rows) {
    if (!Array.isArray(rows)) return { rows: [], hidden: [] };
    const kept = [], hidden = [];
    for (const row of rows) {
      if (isFirmwareRow(row) && !allows(row)) hidden.push(row);
      else kept.push(row);
    }
    hiddenRecords = hidden;
    const next = new Map();
    for (const row of hidden) if (row.locationId != null) next.set(String(row.locationId), row);
    hiddenById = next;
    return { rows: kept, hidden };
  }

  return {
    configured: true,
    manifestFile,
    size: items.length,
    items,
    bySha,
    byName,
    has: query => !!resolve(query),
    resolve,
    dialogueItems,
    allows,
    allowsRow: allows,
    partition,
    hidden: id => (id != null ? hiddenById.get(String(id)) || null : null),
    hiddenIds: () => [...hiddenById.keys()],
    hiddenCount: () => hiddenRecords.length,
  };
}

function projectProductFirmware(model, legacy, scope) {
  const normalize = value => String(value||'').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
  const current = scope.dialogueItems().filter(item => item.models.some(m => normalize(m) === normalize(model)));
  const names = new Set(current.map(item => item.name));
  return [...current, ...(legacy||[]).filter(item => !names.has(item.file||item.name)).map(item => ({...item,
    status:'retired-not-current',publicUrl:null,url:null}))];
}
module.exports = { createFirmwareScope, projectProductFirmware, key, rowPath };
