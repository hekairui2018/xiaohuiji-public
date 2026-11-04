'use strict';
// The server module is canonical; the browser consumes the exact same UMD source.
const fs=require('node:fs'),path=require('node:path');
const source=path.resolve(__dirname,'../domain/ordering/output/control-bom-data.cjs');
fs.copyFileSync(source,path.resolve(__dirname,'../frontend/ordering-bom-data.js'));
