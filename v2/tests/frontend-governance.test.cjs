'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/chat-controller.js'),'utf8');
function fixture(request,fetchImpl){
 const context={window:{},fetch:fetchImpl};vm.runInNewContext(source,context);
 const turns=[],ui={input:{value:'R708',disabled:false,focus(){}},sendButton:{disabled:false},state:{history:[]},getSessionId:()=>ui.sid,sid:'session-one',addUserMessage:(...args)=>turns.push(['user',...args]),addAssistantMessage:data=>turns.push(['assistant',data]),addLoading(){},removeLoading(){},setImageState(value){ui.image=value;},assistantTextOf:data=>data.reply,prepareLegacyMessage:()=>true,isSelftestEnv:()=>false};
 const controller=context.window.ChatController.create(ui,{legacy:false,request});return {ui,turns,controller};
}
test('one send lifecycle rejects duplicate sends and keeps channel payload explicit',async()=>{
 let release;const calls=[];const f=fixture(body=>{calls.push(body);return new Promise(r=>release=r);});const pending=f.controller.send();await f.controller.send('duplicate');assert.equal(calls.length,1);assert.equal(f.ui.sendButton.disabled,true);assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{message:'R708',sessionId:'session-one'});release({reply:'answer'});await pending;assert.equal(f.ui.sendButton.disabled,false);assert.equal(f.ui.state.history.length,2);assert.equal(f.turns.length,2);
});
test('late success and failure cannot write into a switched conversation',async()=>{
 for(const fail of [false,true]){let resolve,reject;const f=fixture(()=>new Promise((a,b)=>{resolve=a;reject=b;}));const pending=f.controller.send();f.ui.sid='session-two';f.ui.input.value='new draft';if(fail)reject(Error('old failure'));else resolve({reply:'old answer'});await pending;assert.equal(f.turns.filter(t=>t[0]==='assistant').length,0);assert.equal(f.ui.input.value,'new draft');assert.equal(f.ui.state.history.length,0);assert.equal(f.ui.sendButton.disabled,false);}
});
test('OCR uploads through the native transport then uses the same channel with image ID',async()=>{
 const uploads=[],queries=[];const f=fixture(async b=>{queries.push(b);return {reply:'found'};},async(url,init)=>{uploads.push([url,JSON.parse(init.body)]);return {ok:true,json:async()=>({ok:true,text:'R708',imageId:'image-test'})};});await f.controller.sendImage('data:image/png;base64,dGVzdA==');assert.equal(uploads.length,1);assert.equal(uploads[0][0],'/api/ocr');assert.equal(queries.length,1);assert.equal(queries[0].sessionId,'session-one');assert.equal(queries[0].images[0],'image-test');assert.equal(f.ui.image.busy,false);assert.equal(f.ui.sendButton.disabled,false);
});
test('late OCR result does not query or append an answer into the next session',async()=>{
 let release;let queries=0;const f=fixture(async()=>{queries++;return {reply:'old'};},()=>new Promise(resolve=>release=resolve));const pending=f.controller.sendImage('data:image/png;base64,dGVzdA==');f.ui.sid='session-two';release({ok:true,json:async()=>({ok:true,text:'old OCR',imageId:'old-image'})});await pending;assert.equal(queries,0);assert.equal(f.turns.filter(t=>t[0]==='assistant').length,0);assert.equal(f.ui.sendButton.disabled,false);
});
test('production entry modules do not replace native fetch or message/send functions',()=>{
 const forbidden=/window\.(?:fetch|sendMessage|sendImageMessage|addAssistantMessage|addUserMessage|assistantTextOf)\s*=/;
 for(const file of ['app.js','site-compat.js','offline-client.js','local-knowledge.js','conversation-client.js'])assert.ok(!forbidden.test(fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8')),file+' reintroduces runtime overrides');
});