'use strict';
function queryResources(topic,knowledge){
 if(!topic||!knowledge)return null;const assets=knowledge.assets(),text=topic.toLowerCase();
 if(/视频|教程|演示/.test(topic)){
  const groups=[['复位','重置','恢复出厂'],['u盘','优盘','usb'],['wifi','wi-fi','无线'],['拼接','级联','多画面']];
  const terms=groups.filter(words=>words.some(w=>text.includes(w))).flat();
  const items=assets.videos.filter(v=>v.status==='uploaded'&&v.publicUrl&&(terms.length?terms.some(t=>v.name.toLowerCase().includes(t)):text.includes(v.name.replace(/\.mp4$/i,'').toLowerCase())));
  if(items.length)return {kind:'videos',items};
 }
 if(/软件|下载|安装|说明书|手册/.test(topic)||assets.softwareCatalog.some(s=>text.includes(s.name.toLowerCase()))){
  const matches=assets.softwareCatalog.filter(s=>[s.name,...s.aliases].some(a=>text.includes(a.toLowerCase())));
  if(matches.length)return {kind:'software',items:matches.map(s=>({...s,download:assets.software.find(d=>d.file===s.file&&d.status==='uploaded')||null,manuals:assets.manuals.filter(m=>m.softwareId===s.id&&m.status==='uploaded')}))};
 }
 return null;
}
module.exports={queryResources};
