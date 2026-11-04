const {test}=require('node:test'),assert=require('node:assert/strict');
const {createResponder}=require('./responder.cjs');
const frame=(id='a',text='712规格书')=>({headers:{req_id:id},body:{msgid:id,chattype:'single',msgtype:'text',from:{userid:'alice'},text:{content:text}}});
function setup(overrides={}){
 const sent=[],events=[],state={received:0,completed:0,failed:0,notificationFailures:0,fileFailures:0,filesSent:0};
 const client={replyStream:async(_f,_s,text,finish)=>sent.push({text,finish}),sendMessage:async(_t,b)=>sent.push({text:b.markdown.content,proactive:true}),...overrides.client};
 const core={answer:async()=>({reply:'found answer',bridgeMode:'expert'}),...overrides.core};
 return {...createResponder({client,core,documents:{prepare:async()=>[]},state,onError:(stage,error)=>events.push({stage,error})}),state,sent,events};
}
test('waiting ack failure never blocks core answer',async()=>{let called=0;const r=setup({client:{replyStream:async(_f,_s,_t,finish)=>{if(!finish)throw Error('Reply ack timeout');}},core:{answer:async()=>{called++;return {reply:'answer',bridgeMode:'expert'};}}});await r.handle(frame());assert.equal(called,1);assert.equal(r.state.completed,1);assert.equal(r.state.failed,0);assert.equal(r.state.notificationFailures,1);assert.equal(r.events[0].stage,'waiting-notice');});
test('final callback failure delivers same answer by active markdown',async()=>{const r=setup({client:{replyStream:async(_f,_s,_t,finish)=>{if(finish)throw Error('callback expired');}}});await r.handle(frame());assert.equal(r.state.completed,1);assert.equal(r.sent[0].text,'found answer');assert.equal(r.sent[0].proactive,true);});
test('core failure has stage diagnostic and customer notice',async()=>{const r=setup({core:{answer:async()=>{throw Error('fetch failed');}}});await r.handle(frame());assert.equal(r.state.failed,1);assert.equal(r.state.lastError.stage,'core');assert.match(r.sent.at(-1).text,/问答服务暂时未能连接/);});
test('same customer serialized and callback retries deduplicated',async()=>{let running=0,peak=0;const seen=[];const r=setup({core:{answer:async(_key,text)=>{running++;peak=Math.max(peak,running);seen.push(text);await new Promise(done=>setTimeout(done,10));running--;return {reply:text,bridgeMode:'expert'};}}});await Promise.all([r.handle(frame('a','one')),r.handle(frame('b','two')),r.handle(frame('a','one'))]);assert.equal(peak,1);assert.deepEqual(seen,['one','two']);assert.equal(r.state.completed,2);assert.equal(r.active(),0);});
