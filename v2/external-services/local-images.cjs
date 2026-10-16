'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
function createLocalImages(directory){fs.mkdirSync(directory,{recursive:true});
 return {async recognize(input){const m=/^data:image\/(png|jpeg|jpg|webp|bmp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(input.image||'');
  if(!m)return {ok:false,code:'bad-image',message:'请提供PNG、JPG等有效图片。'};const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>10*1024*1024)return {ok:false,code:'image-too-large',message:'图片大小上限10MB。'};
  const id=crypto.randomUUID(),file=path.join(directory,id+'.'+m[1]);fs.writeFileSync(file,bytes);
  try{const text=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'local-ocr.ps1'),'-ImagePath',file],{windowsHide:true,timeout:20000,encoding:'utf8',maxBuffer:1024*1024},(e,out)=>e?reject(e):resolve(out)));
   const r=JSON.parse(text.replace(/^\uFEFF/,''));fs.writeFileSync(path.join(directory,id+'.ocr.json'),JSON.stringify(r));return {...r,imageId:id};
  }catch{return {ok:false,code:'local-ocr-unavailable',message:'本地图片识别暂不可用，可继续输入文字；图片没有上传云端。'};}
 }};
}
module.exports={createLocalImages};
