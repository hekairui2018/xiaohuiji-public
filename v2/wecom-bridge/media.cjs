'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
function createMedia({sdkRoot,workbookFile}){
 const {Resvg}=createRequire(path.resolve(sdkRoot,'package.json'))('@resvg/resvg-js');
 function svgImage(svg){
  if(typeof svg!=='string'||svg.length>4*1024*1024||!/<svg[\s>]/i.test(svg)||/<(?:script|foreignObject|!DOCTYPE|!ENTITY)|\bon\w+\s*=|@import/i.test(svg))throw Error('unsafe-svg');
  for(const match of svg.matchAll(/(?:href|xlink:href)\s*=\s*['"]([^'"]*)['"]/gi))if(!/^(?:#|data:image\/(?:png|jpeg);base64,)/.test(match[1]))throw Error('external-svg-resource');
  for(const match of svg.matchAll(/url\(([^)]+)\)/gi))if(!match[1].trim().replace(/^['"]|['"]$/g,'').startsWith('#'))throw Error('external-svg-style');
  const fontFile='C:/Windows/Fonts/msyh.ttc',font=fs.existsSync(fontFile)?{fontFiles:[fontFile],loadSystemFonts:false,defaultFontFamily:'Microsoft YaHei'}:{loadSystemFonts:true};
  let image=new Resvg(svg,{background:'white',font});
  if(!Number.isFinite(image.width)||!Number.isFinite(image.height)||image.width<=0||image.height<=0)throw Error('invalid-svg-size');
  const zoom=Math.min(1600/image.width,4096/image.height,2);
  image=new Resvg(svg,{background:'white',font,fitTo:{mode:'zoom',value:zoom}});
  const rendered=image.render(),buffer=Buffer.from(rendered.asPng());
  if(buffer.length>20*1024*1024)throw Error('image-too-large');
  return {buffer,width:rendered.width,height:rendered.height};
 }
 async function workbook(result){
  if(!workbookFile)throw Error('workbook-renderer-not-configured');
  class Image{
   async decode(){const prefix='data:image/svg+xml;charset=utf-8,';if(!this.src.startsWith(prefix))throw Error('unsupported-workbook-image');const image=svgImage(decodeURIComponent(this.src.slice(prefix.length)));this.buffer=image.buffer;this.naturalWidth=image.width;this.naturalHeight=image.height;}
  }
  const document={createElement(tag){if(tag!=='canvas')throw Error('unsupported-workbook-element');let image;return {getContext(){return {fillRect(){},drawImage(img){image=img;}};},toBlob(callback){callback(new Blob([image.buffer],{type:'image/png'}));}};}};
  const context={window:{},Image,document,TextEncoder,Uint8Array,DataView,Blob,Date,encodeURIComponent};
  vm.runInNewContext(fs.readFileSync(workbookFile,'utf8'),context,{timeout:1000,filename:'ordering-workbook.js'});
  return Buffer.from(await (await context.window.OrderingWorkbook.build(result)).arrayBuffer());
 }
 function dataImage(url){
  if(typeof url!=='string')throw Error('missing-image');
  if(url.startsWith('data:image/svg+xml;charset=utf-8,'))return svgImage(decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))).buffer;
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);if(!match)throw Error('unsupported-image-data');
  const buffer=Buffer.from(match[2],'base64');if(buffer.length>20*1024*1024)throw Error('image-too-large');return buffer;
 }
 return {svgImage,workbook,dataImage};
}
module.exports={createMedia};
