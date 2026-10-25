'use strict';
// Read-only names/directories. Binary metadata never becomes product evidence.
function createDriveCatalog(file){
 const {DatabaseSync}=require('node:sqlite');
 const db=new DatabaseSync(file,{readOnly:true});
 function search(query,{limit=20}={}){
  const terms=String(query).normalize('NFKC').match(/[A-Za-z]+[A-Za-z0-9_.+-]*|[\u3400-\u9fff]{2,}|\d{3,}/g)||[];
  const words=terms.filter(s=>!/^(?:帮我|请问|查找|查询|搜索|下载|资料|文件|给我|找一下|固件|说明书|规格书)$/.test(s)).slice(0,8);
  for(const category of ['固件','规格书','说明书'])if(String(query).includes(category)&&!words.includes(category))words.push(category);
  if(!words.length)return [];
  const escape=s=>s.replace(/[\\%_]/g,'\\$&');
  const where=words.map(()=>"path LIKE ? ESCAPE '\\'").join(' AND ');
  return db.prepare('SELECT path,size,extension,kind,sha256 FROM files WHERE seen=(SELECT max(seen) FROM files) AND '+where+' ORDER BY length(path),path LIMIT ?').all(...words.map(w=>'%'+escape(w)+'%'),Math.max(1,Math.min(50,limit))).map(r=>({name:r.path.split(/[\\/]/).at(-1),directory:r.path.split(/[\\/]/).slice(0,-1).join(' / '),sizeBytes:r.size,extension:r.extension,sha256:r.sha256||null,sourceKind:'drive-file-metadata',bodyParsed:false,available:false,download:null,compatibilityConfirmed:false}));
 }
 return {search,close:()=>db.close()};
}
module.exports={createDriveCatalog};
