'use strict';
const text=v=>typeof v==='string'?v.trim():'';
function model(v){const s=text(v).replace(/^HD[-_ ]/i,'');return s.length<=64&&/^[A-Za-z]{1,5}\d{1,5}[A-Za-z0-9]{0,8}(?: (?:Plus|Green|Pro|Mini|Lite|Max)){0,2}$/i.test(s)?s:'';}
const version=v=>typeof v==='string'&&/^\d+(?:\.\d+)+$/.test(v);
function candidates(r){return Array.isArray(r.model_candidates)?r.model_candidates.map(model).filter(Boolean):[];}
function hardwareModel(r){
 if(['firmware_directory','not_collected','hdset_version_suffix_candidates'].includes(r.model_source))return '';
 const m=model(r.model),options=candidates(r);
 if(r.model_source==='hdset_version_suffix_mapping'&&(new Set(options).size>1||options.length===1&&options[0]!==m||r.model_evidence_version&&r.model_evidence_suffix&&!r.model_evidence_version.endsWith('.'+r.model_evidence_suffix)))return '';
 return m;
}
function receiverLabel(r){const m=hardwareModel(r),options=candidates(r);
 if(m)return m+(r.model_source==='hdset_version_suffix_mapping'?'（实读版本对照表匹配）':'');
 return options.length?'型号待确认（候选：'+options.join('、')+'；'+(['hdset_version_suffix_mapping','hdset_version_suffix_candidates'].includes(r.model_source)?'实读版本尾缀对照表':'候选来源待核对')+'）':'型号未确认';
}
function cardIdentity(r,e){return !!(r&&e.upgrade_run_id&&r.run_id===e.upgrade_run_id&&e.device_code&&r.device_id===e.device_code&&Number.isSafeInteger(r.port)&&r.port>=0&&typeof r.card_id==='string'&&r.card_id);}
function cardResult(r){
 const matched=r.status==='matched_no_upgrade'&&r.match_confirmed===true&&r.status_source==='explicit_version_comparison'&&version(r.before_version)&&r.before_version===r.target_version;
 const readback=r.after_confirmed===true&&r.after_version_source==='hdset_upgrade_readback'&&version(r.after_version);
 const upgraded=r.status==='succeeded'&&readback&&r.after_version===r.target_version;
 const report=r.write_reported_finished===true&&['succeeded','failed'].includes(r.write_reported_status)&&['hdset_write_result_explicit_port','hdset_write_result_single_port_batch'].includes(r.write_reported_source);
 return {matched,readback,upgraded,report,reportConflict:report&&r.write_reported_status==='succeeded'&&r.status==='failed'};
}
module.exports={model,version,candidates,hardwareModel,receiverLabel,cardIdentity,cardResult};
