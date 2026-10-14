'use strict';
function modelId(value){
 const bare=String(value??'').trim().toUpperCase().replace(/^HD[-_\s]?/,'').replace(/\s+/g,'');
 if(!bare||!/[0-9]/.test(bare)||!/[A-Z]/.test(bare)||!/^[A-Z0-9][A-Z0-9_+-]*$/.test(bare))return null;
 return 'HD-'+bare;
}
module.exports={modelId};
