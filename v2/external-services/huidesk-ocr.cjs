'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');

// Reuse GrayDesk's pure OCR pipe protocol, never its clipboard, UI or connection pipeline.
function defaultExecutable(){return process.env.XHJ_HUIDESK_OCR_EXE||(process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Programs','GrayDesk','灰Desk.exe'):null);}
function documentResult(document){
 if(!document||!Array.isArray(document.Blocks)||document.Blocks.length>20000||!Number.isSafeInteger(document.Width)||!Number.isSafeInteger(document.Height)||document.Width<1||document.Height<1||document.Width*document.Height>50000000||!String(document.Engine||'').includes('PP-OCRv5'))throw Error('invalid-ocr-result');
 const blocks=document.Blocks.map(block=>{
  const b=block.Bounds;if(typeof block.Text!=='string'||!b||!['X','Y','Width','Height'].every(k=>Number.isFinite(b[k]))||b.Width<0||b.Height<0)throw Error('invalid-ocr-block');
  return {text:block.Text,bounds:{x:b.X,y:b.Y,width:b.Width,height:b.Height},confidence:Number.isFinite(block.Confidence)?block.Confidence:null};
 });
 // PP-OCR word boxes may contain individual characters. Reconstruct reading lines by geometry,
 // preserving the original boxes/confidence separately; there are no product/engineering rules here.
 const lines=[];
 for(const block of blocks.filter(b=>b.text.trim()).sort((a,b)=>a.bounds.y-b.bounds.y||a.bounds.x-b.bounds.x)){
  const box=block.bounds,center=box.y+box.height/2;
  let line=lines.find(line=>Math.abs(line.center-center)<=Math.max(2,Math.min(line.height,box.height)*.45));
  if(!line){line={center,height:box.height,blocks:[]};lines.push(line);}
  line.blocks.push(block);
 }
 const text=lines.sort((a,b)=>a.center-b.center).map(line=>{let previous=null,value='';for(const block of line.blocks.sort((a,b)=>a.bounds.x-b.bounds.x)){if(previous&&block.bounds.x-(previous.x+previous.width)>Math.max(2,Math.min(previous.height,block.bounds.height)*.25))value+=' ';value+=block.text;previous=block.bounds;}return value;}).join('\n');
 return {ok:true,text,engine:document.Engine,provider:'huidesk-ppocrv5',language:'zh-Hans-CN',width:document.Width,height:document.Height,blocks,rotation:document.Rotation||0,...(Number.isFinite(document.ElapsedMs)?{engineElapsedMs:document.ElapsedMs}:{})};
}
function createHuideskOcr({executable=defaultExecutable(),diagnosticsDirectory,spawnWorker=spawn,timeoutMs=60000,maxPending=2,maxOutputBytes=8*1024*1024}={}){
 let tail=Promise.resolve(),pending=0;
 function run(image){
  if(!executable||!path.isAbsolute(executable)||!fs.existsSync(executable))return Promise.reject(Error('huidesk-ocr-not-configured'));
  return new Promise((resolve,reject)=>{
   let child,done=false,output='',size=0,fault=null,timer;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
   const stop=error=>{fault=error;try{child.kill();}catch{finish(error);}};
   try{
    child=spawnWorker(executable,['--ocr-worker',String(process.pid)],{cwd:path.dirname(executable),windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,GRAYDESK_OCR_BACKGROUND:'1',...(diagnosticsDirectory?{GRAYDESK_DIAGNOSTIC_ROOT:diagnosticsDirectory}:{})}});
    try{if(child.pid)os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
    timer=setTimeout(()=>stop(Error('huidesk-ocr-timeout')),timeoutMs);
    child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{size+=Buffer.byteLength(part);if(size>maxOutputBytes){stop(Error('huidesk-ocr-output-limit'));return;}output+=part;});
    child.stderr.on('data',()=>{}); // Drain native diagnostics without logging image or recognized text.
    child.on('error',()=>finish(Error('huidesk-ocr-worker-start-failed')));
    child.stdin.on('error',()=>{if(!done)stop(Error('huidesk-ocr-pipe-failed'));});
    child.on('close',code=>{if(fault)return finish(fault);if(code!==0)return finish(Error('huidesk-ocr-worker-exited'));try{const result=JSON.parse(output.replace(/^\uFEFF/,'').trim());if(result.Error)throw Error('huidesk-ocr-recognition-failed');finish(null,documentResult(result.Document));}catch(error){finish(error);}});
    child.stdin.end(JSON.stringify({Kind:'read',Image:image.toString('base64'),Rotation:0,Contrast:false})+'\n');
   }catch{try{child?.kill();}catch{}finish(Error('huidesk-ocr-worker-start-failed'));}
  });
 }
 return {read(image){if(pending>=maxPending)return Promise.reject(Error('huidesk-ocr-busy'));pending++;const work=tail.then(()=>run(image)).finally(()=>pending--);tail=work.catch(()=>{});return work;}};
}
module.exports={createHuideskOcr,documentResult};
