'use strict';
// No provider, key, fetch or SDK. Structured requests remain the primary input.
function understand(input){
 if(input&&typeof input==='object'&&!Array.isArray(input))return {demand:input};
 return {status:'needs_input',missing_parameters:[{path:'/operation',reason:'请提供标准需求JSON，选择配单、售后或咨询'}]};
}
module.exports={understand};
