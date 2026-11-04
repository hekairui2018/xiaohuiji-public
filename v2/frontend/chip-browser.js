'use strict';
window.ChipBrowser=(()=>{
 let pending;
 const make=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el};
 const key=s=>String(s).normalize('NFKC').replace(/[\s,_，、—–-]/g,'').toUpperCase();
 const matches=(item,q)=>key(item.label+' '+item.records.flatMap(r=>r.models).join(' ')).includes(q);
 function load(){return pending??=fetch('/v2/chip-browser').then(async r=>{if(!r.ok)throw Error('芯片目录暂不可用');return r.json()}).catch(e=>{pending=null;throw e});}
 async function candidates(query){if(!query.trim()||document.body.dataset.audience==='public')return [];const data=await load(),q=key(query);return [...new Set(data.groups.flatMap(g=>g.items.filter(item=>matches(item,q)).flatMap(item=>{const models=item.records.flatMap(r=>r.models),matched=models.filter(model=>key(model).includes(q));return matched.length?matched:models;})))];}
 async function hasMatches(query){return (await candidates(query)).length>0;}
 async function mount(parent,initial=''){
  if(document.body.dataset.audience==='public')return;
  const shell=make('details');shell.className='doc-cat-group chip-browser';const summary=make('summary','芯片');shell.append(summary);parent.append(shell);shell.open=!!initial;
  const loading=make('p','读取芯片表…');shell.append(loading);
  try{
   const data=await load();loading.remove();
   const body=make('div');body.className='chip-browser-body';const search=make('input');search.type='search';search.placeholder='输入芯片数字或完整型号，如 6363、DP3364S';search.setAttribute('aria-label','搜索芯片');search.value=initial;body.append(search);
   const layout=make('div');layout.className='chip-browser-layout';const nav=make('div');nav.className='chip-series';nav.setAttribute('role','group');nav.setAttribute('aria-label','芯片系列');const select=make('select');select.className='chip-series-select';select.setAttribute('aria-label','选择芯片系列');
   const content=make('div');content.className='chip-content';const grid=make('div');grid.className='chip-grid';const detail=make('section');detail.className='chip-detail';detail.setAttribute('aria-live','polite');content.append(grid,detail);layout.append(nav,content);body.append(select,layout);shell.append(body);
   let active=data.groups[0]?.name||'',selected=null;
   function show(item,button,lookupModel){selected?.setAttribute('aria-pressed','false');selected=button;button.setAttribute('aria-pressed','true');detail.replaceChildren(make('strong',item.label));
    window.dispatchEvent(new CustomEvent('v2-mascot-context',{detail:{query:item.label,chip:true}}));
    if(!item.records.length)detail.append(make('p','HDSet 芯片选项；当前索引没有精确对应记录。'));
    for(const r of item.records){detail.append(make('p','芯片型号：'+r.models.join(' / ')),make('p','智能设置：'+(r.smartSelection||'表中未注明')),make('p','固件类型：'+(r.firmwareType||'表中未注明')),make('small','芯片选型表 '+data.sourceVersion+' · 第 '+r.page+' 页'));}
    detail.append(make('small','固件类型来自选型表，具体文件仍需结合接收卡及现场条件核对。'));
    const query=make('button','查找相关资料');query.type='button';query.onclick=()=>{document.getElementById('quickSearchInput').value=lookupModel||item.records[0]?.models?.[0]||item.label;document.getElementById('quickSearchBtn').click()};detail.append(query);
   }
   function render(){const q=key(search.value);nav.replaceChildren();select.replaceChildren();grid.replaceChildren();detail.replaceChildren();selected=null;
    const groups=data.groups.filter(g=>!q||g.items.some(i=>matches(i,q)));
    for(const g of groups){const b=make('button',g.name);b.type='button';b.setAttribute('aria-pressed',String(active===g.name));b.onclick=()=>{active=g.name;render()};nav.append(b);const o=make('option',g.name);o.value=g.name;select.append(o);}
    if(!groups.some(g=>g.name===active))active=groups[0]?.name||'';select.value=active;
    const visible=q?groups:groups.filter(g=>g.name===active);
    for(const g of visible){if(q)grid.append(make('strong',g.name));for(const item of g.items.filter(i=>!q||matches(i,q))){const matched=q?item.records.flatMap(r=>r.models).filter(model=>key(model).includes(q)):[],label=matched.length?[...new Set(matched)].join(' / '):item.label,records=matched.length?item.records.filter(r=>r.models.some(model=>key(model).includes(q))):item.records;const b=make('button',label);b.type='button';b.className='chip-option';b.title=item.label;b.setAttribute('aria-pressed','false');b.onclick=()=>show({...item,label,records},b,matched[0]);grid.append(b);}}
    if(!grid.childNodes.length)grid.append(make('p','未找到对应芯片，请核对完整型号。'));
   }
   search.oninput=()=>{shell.open=true;render()};select.onchange=()=>{active=select.value;render()};render();
  }catch{loading.textContent='芯片表暂不可用，请重试';}
 }
 return {mount,hasMatches,candidates};
})();
