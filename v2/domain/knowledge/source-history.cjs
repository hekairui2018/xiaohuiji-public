'use strict';
// Source archive membership is not evidence of firmware compatibility or invalidity.
// Match directory labels, not arbitrary filenames, years, or absence from a website.
function sourceHistory(item,copies=[]){
 const rows=[item,...copies],folders=rows.flatMap(r=>[...(r.folders||[]),...String(r.sourceDirectory||'').split(/[\\/]/).map(s=>s.trim())]);
 const archivedDirectory=/^(?:(?:\d+[-_.、 ]*)?(?:20\d{2}[-_.、 ]*)?历史资料|历史报告|旧版资料|旧版本(?:安装包)?|旧款发送卡固件|已停产(?:旧卡)?(?:资料|固件)|已作废资料|.+旧屏参文件|.+固件[（(]老版本[）)]|legacy-manuals)$/i;
 const directories=[...new Set(folders.filter(f=>archivedDirectory.test(f)))];
 const explicit=rows.some(r=>r.versionSelection==='historical'||['superseded','archived','withdrawn'].includes(r.lifecycleStatus)||r.historyStatus==='archived-not-automatically-invalid');
 return {archived:explicit||directories.length>0,historyStatus:explicit||directories.length?'archived-not-automatically-invalid':'not-established',historyBasis:explicit?'explicit-lifecycle-or-compared-family':directories.length?'registered-archive-directory':null,historyDirectories:directories};
}
module.exports={sourceHistory};
