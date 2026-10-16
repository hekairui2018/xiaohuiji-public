'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLanGuard}=require('../adapters/http/lan-access.cjs');
test('LAN access validates actual peer, Host and browser origin without trusting forwarded headers',()=>{
 const guard=createLanGuard({address:'127.0.0.2',cidr:'127.0.0.2/24',port:4520});
 const run=(ip,headers)=>{const res={setHeader(){},writeHead(s){this.status=s;},end(){}};return {ok:guard({socket:{remoteAddress:ip},headers},res),status:res.status};};
 assert.equal(run('127.0.0.3',{host:'127.0.0.2:4520',origin:'http://127.0.0.2:4520'}).ok,true);
 assert.equal(run('::ffff:127.0.0.3',{host:'127.0.0.2:4520'}).ok,true);
 assert.equal(run('203.0.113.1',{host:'127.0.0.2:4520','x-forwarded-for':'127.0.0.3'}).status,403);
 assert.equal(run('127.0.0.3',{host:'attacker.example:4520'}).status,403);
 assert.equal(run('127.0.0.3',{host:'127.0.0.2:4520',origin:'https://attacker.example'}).status,403);
 assert.equal(run('127.0.0.3',{host:'127.0.0.2:4520','sec-fetch-site':'cross-site'}).status,403);
 assert.equal(run('127.0.0.1',{host:'localhost:4520'}).ok,true);
});
