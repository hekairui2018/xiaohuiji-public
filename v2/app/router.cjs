'use strict';
const OPERATIONS=Object.freeze(['ordering','aftersales','consultation']);
function createRouter(handlers){
 for(const op of OPERATIONS)if(typeof handlers[op]!=='function')throw Error('Missing handler: '+op);
 return async demand=>{
  if(!OPERATIONS.includes(demand.operation))throw Error('Unknown dialogue operation');
  return handlers[demand.operation](demand);
 };
}
module.exports={createRouter,OPERATIONS};
