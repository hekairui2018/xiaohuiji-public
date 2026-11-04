const {test}=require('node:test'),assert=require('node:assert/strict');
const {orderingLabel}=require('./ordering-label.cjs'),{createResponder}=require('./responder.cjs');
test('selected core identity is authoritative and ambiguous identity is not guessed',()=>{assert.equal(orderingLabel({plan:{},selectedOptionId:3}).id,3);assert.equal(orderingLabel({plan:{},options:[{id:1},{id:2}]}).id,null);});
test('all options delivered individually and original selection restored without recalculating locally',async()=>{
 const calls=[],sent=[],result=id=>({reply:'方案'+id,bridgeMode:'expert',result:{selectedOptionId:id,plan:{},options:[{id:1},{id:2}]}});
 const r=createResponder({client:{replyStream:async()=>{},sendMessage:async(_t,b)=>sent.push(b.markdown.content)},core:{answer:async(_k,m)=>{calls.push(m);return result(m.endsWith('2')?2:1);}},presentation:{plan:d=>({text:d.reply,items:[],choices:[{label:'一',message:'配单方案：1'},{label:'二',message:'配单方案：2'}]}),resolve:async()=>{}},state:{received:0,completed:0,failed:0,fileFailures:0,notificationFailures:0}});
 for(const [id,message]of [['a','配单'],['b','全部方案']])await r.handle({headers:{req_id:id},body:{msgid:id,chattype:'single',from:{userid:'test'},msgtype:'text',text:{content:message}}});
 assert.deepEqual(calls,['配单','配单方案：1','配单方案：2','配单方案：1']);assert.ok(sent.includes('方案1'));assert.ok(sent.includes('方案2'));assert.match(sent.at(-1),/恢复为方案1/);
});
