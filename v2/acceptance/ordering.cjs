'use strict';
const {report}=require('./report.cjs');
const {modelId}=require('../domain/identity/model-id.cjs');
const {c16CanDrive}=require('../domain/ordering/c16-sharing.cjs');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function createOrderingAudit(dataset,knowledge){
 const modules=new Map(dataset.modules().map(m=>[m.id,m])),devices=dataset.devices(),receivers=dataset.receivers();
 return result=>{const r=report('ordering');try{
  if(result.plan?.architecture==='direct'){
   const {module,controller,screen,directOutputs,cells,ports}=result.plan,hub=controller.hub?.find(h=>h.name==='75');
   r.check('source-module-unchanged',JSON.stringify(modules.get(module.id))===JSON.stringify(module));r.check('source-controller-unchanged',devices.some(d=>JSON.stringify(d)===JSON.stringify(controller)));
   r.check('direct-family-and-interface',controller.category==='异步控制卡'&&['D16','C08L','C16L','C16H'].includes(controller.model)&&module.interface==='HUB75'&&hub?.count>0);
   if(['C16L','C16H'].includes(controller.model))r.check('c16-direct-scope',result.normalizedDemand?.requirements?.c16Sharing===true&&c16CanDrive(controller,module,screen.columns,screen.rows));
   r.check('positive-integral-direct-grid',integer(screen.columns)&&screen.columns>0&&integer(screen.rows)&&screen.rows>0);
   const input=result.normalizedDemand;if(input){r.check('requested-direct-mode',input.architecture==='direct'&&input.controlMode==='async'&&input.requirements?.controllerFamily==='asyncCard');r.check('direct-requested-peripherals',(input.requirements?.peripherals||[]).every(p=>controller.peripherals?.includes(p)));}
   r.check('direct-screen-capacity',screen.pixelWidth===screen.columns*module.resolution[0]&&screen.pixelHeight===screen.rows*module.resolution[1]&&screen.points===screen.pixelWidth*screen.pixelHeight&&screen.points<=controller.totalPoints&&screen.pixelWidth<=controller.maxWidth&&screen.pixelHeight<=controller.maxHeight);
   const count=screen.columns*screen.rows,positions=new Set(),ids=new Set();let valid=directOutputs.length===count&&count<=hub.count;
   for(const o of directOutputs){const key=o.col+':'+o.row;if(!integer(o.col)||!integer(o.row)||o.col>=screen.columns||o.row>=screen.rows||positions.has(key)||!integer(o.hubId)||o.hubId<1||o.hubId>hub.count||ids.has(o.hubId)||o.pixelWidth!==module.resolution[0]||o.pixelHeight!==module.resolution[1])valid=false;positions.add(key);ids.add(o.hubId);}
   r.check('direct-exact-cover',valid);r.check('no-fictitious-receivers-or-ports',cells.length===0&&ports.length===0&&result.topology.receivers.length===0&&result.topology.ports.length===0);
   r.check('direct-bom',JSON.stringify(result.bom)===JSON.stringify([{kind:'module',modelId:'module-'+module.id,quantity:count},{kind:'controller',modelId:'HD-'+controller.model,quantity:1}]));
   r.check('direct-topology',JSON.stringify(result.topology.directOutputs)===JSON.stringify(directOutputs)&&result.topology.screen.width===screen.pixelWidth&&result.topology.screen.height===screen.pixelHeight);
   r.pending('direct-hardware-wiring','逻辑HUB接口分配不等于排线接法、固件与实物兼容验证');return r.finish();
  }
  const {plan,bom,topology}=result,{module,receiver,controller,screen,cells,ports}=plan;
  r.check('source-module-unchanged',JSON.stringify(modules.get(module.id))===JSON.stringify(module));
  r.check('source-controller-unchanged',devices.some(d=>JSON.stringify(d)===JSON.stringify(controller)));
  const actual=receivers.find(c=>modelId(c.model)===modelId(receiver.model));
  r.check('receiver-source-layout',Boolean(actual&&module.receiveCard.some(c=>c.model===receiver.model&&c.width===receiver.width&&c.height===receiver.height)));
  const interfaceCode=module.interface.replace(/^HUB/i,'').toLowerCase();
  if(actual&&interfaceCode===String(actual.interface.type).toLowerCase())r.check('receiver-interface',true,{interface:module.interface,receiver:actual.model});
  else r.pending('receiver-interface-adapter','接口形式不能仅凭案例或布局表认定完全兼容',{moduleInterface:module.interface,receiverInterface:actual?.interface});
  const allRegions=[...cells,...(plan.builtInRegions||[])];
  r.check('positive-integral-geometry',[screen.columns,screen.rows,...module.resolution].every(n=>integer(n)&&n>0)&&allRegions.length>0&&(ports.length>0||plan.builtInRegions?.length>0));
  r.check('screen-pixels',screen.pixelWidth===screen.columns*module.resolution[0]&&screen.pixelHeight===screen.rows*module.resolution[1]&&screen.points===screen.pixelWidth*screen.pixelHeight);
  r.check('controller-loading',screen.points<=controller.totalPoints&&screen.pixelWidth<=controller.maxWidth&&screen.pixelHeight<=controller.maxHeight&&ports.length<=controller.cascadePort);
  const ids=new Set(),occupied=new Set();let coverage=true;
  for(const c of allRegions){if(!integer(c.id)||c.id===0||ids.has(c.id))coverage=false;ids.add(c.id);
   if(![c.col,c.row,c.columns,c.rows].every(integer)||c.columns<1||c.rows<1||c.columns>receiver.width||c.rows>receiver.height){coverage=false;continue;}
   if(c.pixelWidth!==c.columns*module.resolution[0]||c.pixelHeight!==c.rows*module.resolution[1])coverage=false;
   for(let y=c.row;y<c.row+c.rows;y++)for(let x=c.col;x<c.col+c.columns;x++){const key=x+':'+y;if(x>=screen.columns||y>=screen.rows||occupied.has(key))coverage=false;occupied.add(key);}
  }
  r.check('receiver-exact-cover',coverage&&occupied.size===screen.columns*screen.rows);
  if(plan.cabinet){const b=plan.cabinet;r.check('cabinet-grid',screen.columns===b.columns*b.moduleColumns&&screen.rows===b.rows*b.moduleRows);
   r.check('cabinet-receiver-boundaries',allRegions.every(c=>{const x=Math.floor(c.col/b.moduleColumns),y=Math.floor(c.row/b.moduleRows);return c.cabinetId===y*b.columns+x+1&&c.col+c.columns<=(x+1)*b.moduleColumns&&c.row+c.rows<=(y+1)*b.moduleRows;}));
   const requested=result.normalizedDemand?.cabinet;if(requested)r.check('requested-cabinet-preserved',JSON.stringify(requested)===JSON.stringify(b));
  }
  if(plan.builtInRegions){const b=plan.cabinet;r.check('c16-built-in-scope',Boolean(b&&result.normalizedDemand?.requirements?.c16Sharing&&plan.builtInRegions.length===1&&c16CanDrive(controller,module,b.moduleColumns,b.moduleRows)&&plan.builtInRegions[0].cabinetId===b.columns*b.rows));r.check('built-in-topology',JSON.stringify(topology.builtInRegions)===JSON.stringify(plan.builtInRegions));r.pending('c16-mixed-configuration','源条件与数量校验不证明实际排线、固件或混合配置文件兼容');}
  const assigned=new Set(),portIds=new Set();let mapping=true,loading=true;
  for(const port of ports){if(!integer(port.id)||port.id<1||port.id>controller.cascadePort||portIds.has(port.id)||!port.cells.length)mapping=false;portIds.add(port.id);
   for(const c of port.cells){if(assigned.has(c.id)||!cells.some(original=>JSON.stringify(original)===JSON.stringify(c)))mapping=false;assigned.add(c.id);}
   const width=(Math.max(...port.cells.map(c=>c.col+c.columns))-Math.min(...port.cells.map(c=>c.col)))*module.resolution[0];
   const height=(Math.max(...port.cells.map(c=>c.row+c.rows))-Math.min(...port.cells.map(c=>c.row)))*module.resolution[1];
   if(width*height>655360||port.points!==width*height||port.pixelWidth!==width||port.pixelHeight!==height)loading=false;
   if(controller.singleNetworkPorts?.supportive&&(width>controller.singleNetworkPorts.width||height>controller.singleNetworkPorts.height))loading=false;
  }
  r.check('port-mapping',mapping&&assigned.size===cells.length&&cells.every(c=>assigned.has(c.id)));r.check('port-loading',loading,{source:dataset.source});
  const expected=[{kind:'module',modelId:'module-'+module.id,quantity:screen.columns*screen.rows},{kind:'receiver',modelId:'HD-'+receiver.model,quantity:cells.length},{kind:'controller',modelId:'HD-'+controller.model,quantity:1}];
  r.check('bom-counts-models',Array.isArray(bom)&&bom.length===3&&expected.every(e=>bom.filter(b=>b.kind===e.kind&&b.modelId===e.modelId&&b.quantity===e.quantity).length===1));
  r.check('topology-screen',topology?.screen?.width===screen.pixelWidth&&topology?.screen?.height===screen.pixelHeight);
  r.check('topology-receivers',JSON.stringify(topology?.receivers)===JSON.stringify(cells));
  r.check('topology-ports',JSON.stringify(topology?.ports)===JSON.stringify(ports.map(p=>({id:p.id,receiverIds:p.cells.map(c=>c.id)}))));
  const expectedConnections=ports.flatMap(port=>port.cells.map((cell,index)=>({portId:port.id,from:index?{kind:'receiver',id:port.cells[index-1].id}:{kind:'controller',modelId:'HD-'+controller.model,portId:port.id},to:{kind:'receiver',id:cell.id}})));
  r.check('receiver-chain-order',JSON.stringify(topology?.connections)===JSON.stringify(expectedConnections));
  const demand=result.normalizedDemand;if(demand?.screen)r.check('explicit-demand-preserved',['pixelWidth','pixelHeight'].every(k=>demand.screen[k]===undefined||demand.screen[k]===screen[k]));
  if(demand){const requested=demand.requirements||{},playbox=requested.controllerFamily==='playBox';
   r.check('requested-controller-family',controller.category===(requested.controllerFamily==='asyncCard'?'异步控制卡':playbox?'同步异步播放盒':'二合一视频处理器'));
   r.check('requested-peripherals',(requested.peripherals||[]).every(p=>controller.peripherals?.includes(p)));
   r.check('requested-input-sources',(requested.inputSource||[]).every(type=>controller.inputSource?.some(s=>s.type===type&&s.supportive===true)));
   for(const key of ['hdmiOut','dockingCentralControl','ktvRecommended'])if(requested[key])r.check('requested-'+key,controller[key]===true);
   if(requested.posterScreen)r.check('poster-screen-model',['B6L','A6L','B8L'].includes(controller.model));
   if(requested.meetingScreen)r.check('meeting-screen-model',['H6','H8'].includes(controller.model));
  }
  const product=knowledge?.findProducts(receiver.model)?.[0],claims=product?.claims||[];
  const caps=claims.map(c=>c.text.match(/Maximum loading capacity:\s*([\d,]+)\s*pixels/i)).filter(Boolean).map(m=>Number(m[1].replace(/,/g,'')));
  if(caps.length===1)r.check('receiver-declared-maximum',cells.every(c=>c.pixelWidth*c.pixelHeight<=caps[0]),{pixels:caps[0],sources:product.sourceReferences});
  r.pending('hardware-operating-conditions','完整芯片、扫描、硬件批次、固件及实际设备工况尚不能由几何校验代替',{model:receiver.model});
 }catch(error){r.check('ordering-output-structure',false,error.message);}return r.finish();};
}
module.exports={createOrderingAudit};
