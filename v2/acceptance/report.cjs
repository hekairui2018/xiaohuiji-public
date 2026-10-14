'use strict';
function report(area){const checks=[];return {check(id,passed,evidence=null){checks.push({id,status:passed?'passed':'failed',evidence});},pending(id,reason,evidence=null){checks.push({id,status:'pending_manual',reason,evidence});},finish(){const failed=checks.filter(c=>c.status==='failed').length,pending=checks.filter(c=>c.status==='pending_manual').length;return {area,automaticPassed:failed===0,status:failed?'failed':pending?'pending_manual':'passed',counts:{passed:checks.filter(c=>c.status==='passed').length,failed,pending_manual:pending},checks};}};}
module.exports={report};
