'use strict';
// Identity only. Similar model names are never hardware equivalence evidence.
const normalizeModel = value => String(value || '').trim().toUpperCase()
  .replace(/^HD[-_\s]?/, '').replace(/[^A-Z0-9]/g, '');
const patterns=new Map();
function mentionsModel(text, model) {
  const want=normalizeModel(model);
  if(!want)return false;
  let re=patterns.get(want);
  if(!re){const pattern=want.split('').join('[\\s_-]*');
    re=new RegExp('(?<![A-Z0-9])'+pattern+'(?![A-Z0-9])(?![\\s_-]+(?:PRO|PLUS|MAX|MINI|LITE|BOX|\\d+U)\\b)','i');patterns.set(want,re);}
  return re.test(String(text||''));
}
function documentBelongs(file, model) {
  let name=String(file||'').split(/[\\/]/).pop();
  try{name=decodeURIComponent(name);}catch{/* malformed URL is not a reason to guess ownership */}
  return mentionsModel(name,model);
}
function conflictingRelative(text, model, knownModels) {
  const want=normalizeModel(model);
  if(!want)return null;
  for(const name of knownModels){
    const other=normalizeModel(name);
    if(other===want || !other || !(other.startsWith(want)||want.startsWith(other)))continue;
    if(mentionsModel(text,other))return name;
  }
  return null;
}
module.exports={normalizeModel,documentBelongs,mentionsModel,conflictingRelative};
