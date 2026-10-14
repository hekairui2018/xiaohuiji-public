'use strict';
function formatResourceReply(resources){
 if(resources.status==='conflict')return '文件所属型号与请求型号不一致，请核对完整文件名和精确型号。';
 if(resources.status==='needs_input')return resources.reason==='hardware-revision-not-established-in-source'?'当前资料未建立该硬件版本关系，请补充设备丝印、硬件版本与原文件信息。':resources.kind==='videos'?'当前没有与该主题或型号明确关联的视频，请补充软件名称或操作主题。':'该型号暂无通过来源关联核验的这类资料，请确认精确型号和资料类型。';
 if(resources.kind==='chips')return resources.items.map(row=>[row.models.join(' / '),'智能设置：'+(row.smartSelection||'源表未记录'),'固件类别：'+(row.firmwareType||'源表未记录'),'来源：芯片选型 '+row.sourceReference.sourceVersion+' 第'+row.page+'页'].join('\n')).join('\n\n')+'\n\n固件原文件需继续按精确接收卡型号、硬件版本和文件变体核对，可直接查询“R712固件”。';
 if(resources.kind==='firmware')return ['以下是资料中已有的原文件，现场适用关系仍需按硬件版本核对。',...resources.items.map(f=>f.file+'\n型号：'+f.card+'；硬件尾位：'+(f.hwFromFile||'未记载')+'；文件变体：'+(f.variant||'文件名未注明')+'\n'+f.publicUrl)].join('\n\n');
 if(resources.kind==='documents')return resources.items.map(d=>d.name+'\n'+d.url).join('\n\n');
 if(resources.kind==='videos')return resources.items.map(v=>v.name+'：'+v.publicUrl).join('\n\n');
 return resources.items.map(s=>[s.name,s.purpose,s.download?'下载：'+s.download.publicUrl:'',...(s.manuals||[]).map(m=>m.label+'：'+m.publicUrl),...(s.videos?.primary?[s.videos.primary.name+'：'+s.videos.primary.publicUrl]:[])].filter(Boolean).join('\n')).join('\n\n');
}
module.exports={formatResourceReply};
