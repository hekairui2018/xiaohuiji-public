'use strict';
function controlBom(result){
 const materials=require('../../domain/ordering/output/package-bom.cjs').packageBom(result);
 return require('../../domain/ordering/output/control-bom-data.cjs').build({...result,bom:materials.items.map(r=>({...r,modelId:r.model})),warnings:materials.warnings});
}
module.exports={controlBom};
