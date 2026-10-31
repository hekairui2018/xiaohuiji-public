'use strict';
function modelStream(onContent){
 let pending='',event=[],content='',finish=null,usage=null,timings=null,done=false;
 function dispatch(){
  if(!event.length)return;const value=event.join('\n');event=[];
  if(value==='[DONE]'){done=true;return;}
  const data=JSON.parse(value);if(data.error)throw Error('expert-model-stream-error');
  if(data.usage)usage=data.usage;
  if(data.timings)timings=data.timings;
  const choice=data.choices?.[0];if(!choice)return;
  if(choice.finish_reason)finish=choice.finish_reason;
  const delta=choice.delta?.content;
  if(typeof delta==='string'){content+=delta;onContent?.(content);}
 }
 function push(text){pending+=text;let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at).replace(/\r$/,'');pending=pending.slice(at+1);if(!line)dispatch();else if(line.startsWith('data:'))event.push(line.slice(5).trimStart());}}
 return {push,finish(){if(pending)push('\n');dispatch();if(!done&&!finish)throw Error('expert-model-stream-incomplete');return {choices:[{message:{content},finish_reason:finish}],usage,...(timings?{timings}:{})};}};
}
// Extract visible answer strings only; JSON framing, IDs and reasoning are never rendered.
function answerText(content){
 const clarify=/"action"\s*:\s*"clarify"/.test(content),answer=/"action"\s*:\s*"answer"/.test(content);if(!clarify&&!answer)return '';
 const expression=clarify?/(?<!\\)"question"\s*:\s*"/g:/(?<!\\)"text"\s*:\s*"/g;const parts=[];
 for(const match of content.matchAll(expression)){
  let raw='',escaped=false;
  for(let at=match.index+match[0].length;at<content.length;at++){const c=content[at];if(c==='"'&&!escaped)break;raw+=c;if(c==='\\')escaped=!escaped;else escaped=false;}
  raw=raw.replace(/\\u[0-9a-fA-F]{0,3}$|\\$/,'');
  try{const value=JSON.parse('"'+raw+'"').replace(/[\uD800-\uDBFF]$/,'');parts.push(value);}catch{}
 }
 return parts.join('\n\n');
}
module.exports={modelStream,answerText};
