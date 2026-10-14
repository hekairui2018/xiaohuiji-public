'use strict';
// Preserve conditions attached to receiver loading figures; never synthesize device capacity.
function receiverLoadEvidence(keyParameters={},facts=[]){
  const text=[keyParameters.load,...facts].filter(Boolean).join(' ').replace(/(\d)\s+(?=\d)/g,'$1');
  const max=text.match(/Maximum\s+loading\s+capacity\s*:\s*([\d,]+)\s*pixels\s*\((\d+)\s*[*×x]\s*(\d+)\)/i);
  const conventional=text.match(/conventional\s+chip\s*(\d+)\s*[*×x]\s*(\d+)/i);
  const pwm=text.match(/PWM\s+chip\s*(\d+)\s*[*×x]\s*(\d+)/i);
  if(!max||!conventional||!pwm)return null;
  const points=Number(max[1].replace(/,/g,''));
  if(points!==Number(max[2])*Number(max[3]))return null;
  return {maximumPoints:points,maximumRectangle:[Number(max[2]),Number(max[3])],
    recommended:{conventional:[Number(conventional[1]),Number(conventional[2])],pwm:[Number(pwm[1]),Number(pwm[2])]},
    text:`${max[1]}点（${max[2]}×${max[3]}）；推荐常规芯片${conventional[1]}×${conventional[2]}、PWM芯片${pwm[1]}×${pwm[2]}`,
    evidence:{maximum:max[0],conventional:conventional[0],pwm:pwm[0]}};
}
module.exports={receiverLoadEvidence};
