'use strict';
// Reuse a server-owned calculated selection; revalidate geometry and file output,
// without running the selection algorithm or accepting a client-supplied plan.
function exportSelection(selected,kind,deployment={}){
 const result=structuredClone(selected.result);
 if(!result.plan||(!result.provisionalExportDemand&&result.exportAllowed===false))throw Error('selected-plan-not-exportable');
 const validation=require('../../domain/ordering/validator.cjs').validatePlan(result.plan);if(!validation.passed)throw Error('selected-plan-validation-failed');
 result.status='ready';result.operation='ordering';result.validation=validation;result.exportAllowed=true;
 result.normalizedDemand=result.provisionalExportDemand||result.normalizedDemand;
 const shell=require('../data/load-ssm-shell.cjs').loadSsmShell();
 if(kind==='package')return require('../../domain/ordering/output/configuration-package.cjs').configurationPackage(result,shell,deployment);
 const exported=require('../../domain/ordering/output/ssm-export.cjs').exportSsm(result,shell),audit=require('../../acceptance/ssm.cjs').auditSsm(exported,result,shell);
 if(!audit.automaticPassed)throw Error('selected-SSM-audit-failed');return {...exported,acceptance:audit};
}
module.exports={exportSelection};
