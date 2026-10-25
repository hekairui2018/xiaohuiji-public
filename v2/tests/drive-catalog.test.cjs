'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{DatabaseSync}=require('node:sqlite');
const {createDriveCatalog}=require('../adapters/data/drive-catalog.cjs');
test('Directory metadata preserves requested category, escapes SQL wildcards and never exposes file handles',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drive-catalog-'));const file=path.join(dir,'db');const db=new DatabaseSync(file);db.exec('CREATE TABLE files(path TEXT,size INTEGER,extension TEXT,kind TEXT,sha256 TEXT,seen REAL)');const add=db.prepare('INSERT INTO files VALUES(?,?,?,?,?,1)');add.run('固件/X1/芯片123.bin',10,'.bin','file-metadata',null);add.run('规格书/X1.pdf',20,'.pdf','document','a'.repeat(64));db.close();const catalog=createDriveCatalog(file);t.after(()=>{catalog.close();fs.rmSync(dir,{recursive:true,force:true});});const rows=catalog.search('X1 固件');assert.equal(rows.length,1);assert.equal(rows[0].name,'芯片123.bin');assert.equal(rows[0].bodyParsed,false);assert.equal(rows[0].download,null);assert.equal(catalog.search("X1%' OR 1=1--").length,0);
});
