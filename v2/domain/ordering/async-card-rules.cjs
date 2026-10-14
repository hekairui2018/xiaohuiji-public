'use strict';
// Exact dL.C conditions from the frozen official JS. No inferred chip capacities.
function asyncCardFits(device,module,screen,receiverModel){
 if(!['D10','D30','D15','D16','D35','D36','C08L'].includes(device.model))return true;
 if(receiverModel==='R500S')return false;
 // Official PixelWidth is the vertical pixel extent; AreaLong is physical width in mm.
 const count=device.hub?.[0]?.count,columns=screen.columns,rows=screen.rows,pitch=module.dotPitch.spacing,height=screen.pixelHeight,physicalWidth=columns*module.size[0];
 if(!count||rows>count)return false;
 if(device.model==='D16'){
  if(pitch<=2.5)return columns<=count&&columns*rows<=count;
  if(pitch<=3.076)return columns<=count;
  if(pitch===4){if(module.size[0]===320&&module.size[1]===160)return height<=320&&columns*rows<=count*2;if(module.size[0]===256&&module.size[1]===256)return height<=256&&columns*rows<=count*2;}
  return height<=1024;
 }
 if(device.model==='C08L'){
  if(pitch<=3)return columns<=count&&physicalWidth<=2560&&columns*rows<=count;
  if(pitch<5){if(pitch===4){if(module.size[0]===320&&module.size[1]===160)return height<=640&&columns*rows<=count*2;if(module.size[0]===256&&module.size[1]===256)return height<=512&&columns*rows<=count*2;}return height<=1024&&columns*rows<=count;}
  return height<=2048;
 }
 return false;
}
module.exports={asyncCardFits};
