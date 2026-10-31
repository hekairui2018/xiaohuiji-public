'use strict';
// FIFO admission belongs to the expert instance. Only capacity is shared;
// each request retains its own history, evidence, stream and cancellation signal.
function createExpertQueue({maxConcurrent=3,maxWaiting=32}={}){
 if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>5)throw Error('Invalid expert concurrency');
 if(!Number.isInteger(maxWaiting)||maxWaiting<1||maxWaiting>64)throw Error('Invalid expert queue capacity');
 let active=0;const sessions=new Set(),waiting=[];
 const notify=()=>waiting.forEach((entry,i)=>{try{entry.onQueued?.(i+1);}catch{}});
 function start(entry){
  entry.signal?.removeEventListener('abort',entry.abort);active++;let released=false;
  entry.resolve(()=>{if(released)return;released=true;active--;if(entry.session)sessions.delete(entry.session);drain();});
 }
 function drain(){while(active<maxConcurrent&&waiting.length)start(waiting.shift());notify();}
 function acquire({session,signal,onQueued}={}){
  signal?.throwIfAborted();
  if(session&&sessions.has(session))return Promise.reject(Error('session-request-active'));
  if(active>=maxConcurrent&&waiting.length>=maxWaiting)return Promise.reject(Error('expert-queue-full'));
  if(session)sessions.add(session);
  return new Promise((resolve,reject)=>{
   const entry={session,signal,onQueued,resolve,reject};
   entry.abort=()=>{const at=waiting.indexOf(entry);if(at<0)return;waiting.splice(at,1);if(session)sessions.delete(session);signal.removeEventListener('abort',entry.abort);reject(signal.reason);notify();};
   if(active<maxConcurrent&&!waiting.length)start(entry);
   else{waiting.push(entry);signal?.addEventListener('abort',entry.abort,{once:true});notify();if(signal?.aborted)entry.abort();}
  });
 }
 return {acquire};
}
module.exports={createExpertQueue};
