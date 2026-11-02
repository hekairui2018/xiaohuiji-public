'use strict';

const policies = require('../../resource-index/quick-software-scopes.json');
const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_-]/g, '');

function excludesSoftwareScope(software, text) {
  const source = normalize(text);
  return software.some((name) =>
    (policies[name]?.excludedScopes || []).some((scope) => source.includes(normalize(scope))),
  );
}

module.exports = { excludesSoftwareScope };
