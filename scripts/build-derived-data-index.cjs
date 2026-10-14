'use strict';
// Derived artifact only: never rebuild or write production business JSON.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { buildIndex } = require('../backend/data-provenance.cjs');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const output = path.resolve(root, process.argv[2] || 'tmp/derived-data-index.json');
if (!output.startsWith(path.join(root, 'tmp') + path.sep)) throw Error('Derived output must be under the project tmp directory');
if (fs.existsSync(output)) throw Error('Output exists; preserve it and use a new filename');
const inputs = ['data/product-index.json','data/product-specs-index.json','data/aftersales/aftersales-cases.json','data/firmware-manifest.json','backend/ordering/data/ordering-device-catalog.json'];
const [products,specs,cases,firmware,devices] = inputs.map(read);
const index = buildIndex({ products: products.products, specs: specs.products, cases: cases.cases, firmware: firmware.items, devices: devices.devices });
index.inputSHA256 = Object.fromEntries(inputs.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(index,null,2));
console.log(JSON.stringify({output,models:Object.keys(index.models).length,sourceIdentities:Object.keys(index.provenance).length,issues:index.issues},null,2));
