'use strict';
// These labels are manufacturer source variants, not inferred from pixel count.
function moduleInputCount(row){
 const text=String(row.remark||'');
 if(/模组双输入/.test(text))return 2;
 if(/模组单输入/.test(text))return 1;
 return undefined;
}
module.exports={moduleInputCount};
