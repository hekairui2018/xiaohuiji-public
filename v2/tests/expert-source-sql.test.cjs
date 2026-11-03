'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createExpertSourceSql}=require('../domain/knowledge/expert-source-sql.cjs'),{createSectionTools}=require('../adapters/http/section-tools.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-source-'));fs.mkdirSync(root+'/assets');const asset=Buffer.from('synthetic image');fs.writeFileSync(root+'/assets/test.png',asset);
for(const family of ['aftersales','tender']){const db=new DatabaseSync(root+'/'+family+'.private.sqlite');db.exec(`
CREATE TABLE documents(id,name,sha256,source_path);CREATE TABLE entries(id,entry_group,document_id,kind,title,body,context_text,review_state,outcome_state,outcome_evidence_json,rule);
CREATE TABLE entry_entities(entry_id,kind,value,basis);CREATE TABLE assets(sha256,path);CREATE TABLE blocks(id,locator,text);CREATE TABLE entry_blocks(entry_id,block_id,role,start_char,end_char,sequence);CREATE TABLE block_assets(block_id,asset_id);`);
// Match the prepared assets schema used by the reader.
db.exec('DROP TABLE assets; CREATE TABLE assets(id,sha256,path)');
const original=Buffer.from('synthetic source '+family);fs.writeFileSync(root+'/'+family+'.docx',original);db.prepare('INSERT INTO documents VALUES(?,?,?,?)').run('d','合成原件',hash(original),root+'/'+family+'.docx');
const entries=family==='aftersales'?[
['a','g1','FM6363 黑线','原现场是黑线，曾尝试升级但无效。','6363','FM6363'],
['b','g2','SM16380SH 启动色块','VP820开机未识别信号时出现色块；原文记录处理后恢复。','SM16380SH','SM16380SH'],
['c','g3','其他芯片画面抖动','P2.5模组闪烁。原文未记录结果。','OTHER','OTHER'],
['misfiled','g4','FM6124 偏红','明确是FM6124，不是目录所列芯片。','6363','FM6124'],
['dev','g6','A3L 设备现场','A3L设备现场，黑线。','A3L',''],
['long','g5','SM16380SH 长案例','条件\n'+'现场多种现象与原始处理。'.repeat(900)+'末尾结果未改善。','SM16380SH','SM16380SH']
]:[['t','gt','X100 控标','要求提供检测报告，不代表已经取得。','HD-X100','']];
for(const [id,group,title,body,context,chip]of entries){db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,group,'d',family==='tender'?'tender_clause':'case_or_reference',title,body,context,'pending','unknown','["原文状态句仍保留"]','test');if(chip)db.prepare('INSERT INTO entry_entities VALUES(?,?,?,?)').run(id,'chip',chip,'literal-body-no-heading-model');db.prepare('INSERT INTO blocks VALUES(?,?,?)').run(id,'paragraph:'+id,body);db.prepare('INSERT INTO entry_blocks VALUES(?,?,?,?,?,?)').run(id,id,'body',0,body.length,0);}
db.prepare('INSERT INTO assets VALUES(?,?,?)').run('im',hash(asset),'assets/test.png');db.prepare('INSERT INTO block_assets VALUES(?,?)').run(family==='tender'?'t':'b','im');db.close();}
const source=createExpertSourceSql({directory:root});return {root,source,dispose(){source.close();fs.rmSync(root,{recursive:true});}};
}
test('object anchors and semantic phenomena are independent; P2 never becomes P2.5 or inherits a wrong chip folder',()=>{const f=fixture();try{
const scores=new Map([['a',0.3],['b',0.5],['c',0.8],['misfiled',0.1],['long',0.2]]);const rows=f.source.search('aftersales','6363 闪屏',{semanticScores:scores});assert(rows.some(e=>e.match.objectMatches.includes('6363')));assert(rows.some(e=>e.match.semanticRelated&&!e.match.objectConfirmed));assert(!rows.some(e=>e.sourceEntryId==='misfiled'));
assert(f.source.search('aftersales','6363 任意口语描述',{semanticScores:scores}).some(e=>e.match.semanticRelated));
const p=f.source.search('aftersales','P2 屏幕闪');assert(p.every(e=>!e.match.objectMatches.includes('P2')));
}finally{f.dispose();}});
test('a complete source keeps historical failure, unknown review, anchors and image references; long records remain readable',()=>{const f=fixture();try{
const before=hash(fs.readFileSync(f.root+'/aftersales.private.sqlite')),e=f.source.search('aftersales','SM16380SH 启动 色块')[0];assert.equal(e.sourceEntryId,'b');assert(e.caseRecord.originalText.includes('恢复'));assert.equal(e.outcomeState,'unknown');assert.equal(e.reviewState,'pending');assert.equal(e.assets.length,1);assert(e.caseRecord.anchors.length);
const long=f.source.search('aftersales','SM16380SH 长案例',{limit:6}).find(e=>e.sourceEntryId==='long');assert.equal(long.contextComplete,false);let text=long.text,next=long.nextOffset;while(next!==null){const page=f.source.read(long,next);text+=page.text;next=page.nextOffset;}assert(text.endsWith('末尾结果未改善。'));assert.equal(hash(fs.readFileSync(f.root+'/aftersales.private.sqlite')),before);
}finally{f.dispose();}});
test('cases and tender tools use private SQL without substituting the fulltext or quick source',async()=>{const f=fixture();try{const tools=createSectionTools({expertSources:f.source,resourceSearch(){throw Error('wrong source');},resourceAnswer(){throw Error('wrong quick');}});
const found=await tools.execute('search_evidence',{kind:'cases',query:'SM16380SH 色块'});assert(found.evidence.length);assert.equal(found.notice.scope,'expert-aftersales-private-sql');const read=await tools.execute('read_document',{blockId:found.evidence[0].blockId});assert.equal(read.evidence[0].sourceEntryId,'b');await assert.rejects(tools.execute('read_document',{blockId:999}),/invalid-tool/);
const tender=await tools.execute('search_evidence',{kind:'tender',query:'X100 控标 检测报告'});assert.equal(tender.notice.certificationConfirmed,false);assert(tender.evidence[0].text.includes('不代表已经取得'));
}finally{f.dispose();}});
test('private originals and images deny public/cross-site requests and changed bytes',async()=>{const f=fixture();try{const e=f.source.search('aftersales','SM16380SH 色块')[0],response=()=>({status:0,headers:{},writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b;}});
for(const req of [{v2Public:true,headers:{}},{headers:{'sec-fetch-site':'cross-site'}}]){const res=response();await f.source.serve({...req,method:'GET',url:e.assets[0].url},res);assert.equal(res.status,403);}
let res=response();await f.source.serve({method:'GET',headers:{},url:e.assets[0].url},res);assert.equal(res.status,200);assert.equal(res.headers['Cache-Control'],'no-store');
fs.writeFileSync(f.root+'/assets/test.png','changed');res=response();await f.source.serve({method:'GET',headers:{},url:e.assets[0].url},res);assert.equal(res.status,409);
res=response();await f.source.serve({method:'GET',headers:{},url:'/v2/offline/expert-source/file?family=aftersales&id=../../outside'},res);assert.equal(res.status,404);
}finally{f.dispose();}});
test('semantic ranking uses supplied local vectors independently of query wording and verifies the embedding identity',async()=>{const f=fixture();let source;try{
const cache=f.root+'/vectors';fs.mkdirSync(cache);const manifest={modelSha256:'synthetic-model',families:{}};
for(const family of ['aftersales','tender']){const db=new DatabaseSync(f.root+'/'+family+'.private.sqlite',{readOnly:true}),ids=db.prepare('SELECT id FROM entries ORDER BY id').all().map(r=>r.id);db.close();const vectors=new Float32Array(ids.flatMap(id=>id==='c'?[1,0]:[0,1])),bytes=Buffer.from(vectors.buffer);fs.writeFileSync(cache+'/'+family+'.f32',bytes);manifest.families[family]={databaseSha256:hash(fs.readFileSync(f.root+'/'+family+'.private.sqlite')),vectorSha256:hash(bytes),dimensions:2,entries:ids};}
fs.writeFileSync(cache+'/manifest.private.json',JSON.stringify(manifest));let embedded;
source=createExpertSourceSql({directory:f.root,semanticIndex:cache,embed:async q=>{embedded=q;return {modelSha256:'synthetic-model',vector:[1,0]};}});
const a=await source.retrieve('aftersales','6363 客户任意表达'),b=await source.retrieve('aftersales','6363 换一种说法');assert.deepEqual(a.map(e=>e.sourceEntryId),b.map(e=>e.sourceEntryId));assert(!embedded.includes('6363'));assert(a.some(e=>e.sourceEntryId==='c'&&e.match.semanticSimilarity===1));assert(a.every(e=>e.match.phenomenonRelated===null));
}finally{source?.close();f.dispose();}});
test('display and equipment focus change object weights without excluding same-phenomenon references',()=>{const f=fixture();try{
const scores=new Map([['a',0.5],['dev',0.5],['c',0.8]]),query='A3L 6363';
const display=f.source.search('aftersales',query,{semanticScores:scores,problemDomain:'display',limit:6});
const equipment=f.source.search('aftersales',query,{semanticScores:scores,problemDomain:'equipment',limit:6});
assert.equal(display[0].sourceEntryId,'a');assert.equal(equipment[0].sourceEntryId,'dev');assert(display.some(e=>e.sourceEntryId==='c'));assert(equipment.some(e=>e.sourceEntryId==='c'));
}finally{f.dispose();}});
test('model packet preserves source object differences and original outcome evidence without claiming review approval',()=>{
const {answerPacket}=require('../model-adapter/answer-packet.cjs'),e={evidenceId:'case-test',text:'原文记载已解决',outcomeState:'unknown',outcomeEvidence:['已解决'],reviewState:'pending',match:{objectMatches:['CHIP1000'],unconfirmedObjects:['BOX1'],rankingFocus:'display',allConditionsConfirmed:false,objectWeights:{chip:140}},caseRecord:{originalText:'long server-side record'}};
const packed=answerPacket({history:[],preparedEvidence:{evidence:[e]}},[e]).input.preparedEvidence.evidence[0];assert.deepEqual(packed.outcomeEvidence,['已解决']);assert.equal(packed.outcomeState,'unknown');assert.deepEqual(packed.match.unconfirmedObjects,['BOX1']);assert.equal(packed.match.objectWeights,undefined);assert.equal(packed.caseRecord,undefined);
});
test('an explicitly different module pitch is distinct from an unrecorded device',()=>{const f=fixture();try{
const row=f.source.search('aftersales','A3L P2',{semanticScores:new Map([['c',1]]),limit:6}).find(e=>e.sourceEntryId==='c');assert(row);assert.deepEqual(row.match.differentObjects,[{requested:'P2',recorded:['P2.5'],basis:'literal-original-module-pitch'}]);assert(row.match.unconfirmedObjects.includes('A3L'));assert(!row.match.unconfirmedObjects.includes('P2'));
}finally{f.dispose();}});
