'use strict';
// Frozen official Gi/ky/ql conditions; only HUB75 C16L/H built-in regions.
const LIMITS={C16L:{'1.25':8,'1.538':10,'2.5':12,'3':12},C16H:{'1.25':10,'1.538':12,'2.5':16,'3':16}};
function c16CanDrive(controller,module,columns,rows){
 if(!LIMITS[controller.model]||module.interface!=='HUB75')return false;
 const hub=controller.hub?.[0]?.count||12,pitch=module.dotPitch.spacing,size=module.size[0],pixel=module.resolution[0],limits=LIMITS[controller.model];
 if(rows>hub)return false;
 if(pitch<=1.25)return columns<=8&&size*columns<=2560&&columns*rows<=limits['1.25']&&rows<=8;
 if(pitch<=1.538)return columns<=8&&size*columns<=2560&&columns*rows<=limits['1.538']&&rows<=8;
 if(pitch<=2.5)return columns<=8&&size*columns<=2560&&columns*rows<=limits['2.5']&&rows<=8;
 if(pitch<3)return columns<=hub&&size*columns<=3840&&columns*rows<=limits['3']&&rows<=8;
 if(pitch<=3.076)return columns<=hub&&size*columns<=3840&&columns*rows<=24;
 return pixel*columns<=(pitch<=5?1024:2048);
}
function sharedCabinet(cells,cabinet,module,controller){
 if(!c16CanDrive(controller,module,cabinet.moduleColumns,cabinet.moduleRows))return {status:'constraint_failure',reason:'c16-built-in-cabinet-conditions-not-met'};
 const last=cabinet.columns*cabinet.rows,builtInRegions=cells.filter(c=>c.cabinetId===last),external=cells.filter(c=>c.cabinetId!==last);
 if(builtInRegions.length===2)return {status:'constraint_failure',reason:'official-two-card-c16-count-and-diagram-disagree'};
 if(builtInRegions.length!==1)return {status:'constraint_failure',reason:'c16-sharing-requires-established-one-card-box'};
 return {status:'planned',cells:external,builtInRegions,reduction:builtInRegions.length,source:'Gi/hL.filterCabinetReceivingCard'};
}
module.exports={c16CanDrive,sharedCabinet};
