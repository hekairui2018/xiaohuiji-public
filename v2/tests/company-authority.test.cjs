'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {answerAuthority}=require('../model-adapter/answer-authority.cjs');
test('company evidence availability is observed, never guessed from an intent label',()=>{
 assert.equal(answerAuthority().companySources,'not-checked');
 assert.equal(answerAuthority([{readAvailable:true}]).companySources,'candidates-only');
 assert.equal(answerAuthority([{readPerformed:true}]).companySources,'read-sources-available');
 assert.equal(answerAuthority([],[{name:'search_evidence'}]).companySources,'searched-without-evidence');
 assert.equal(answerAuthority([],[{name:'search_evidence',error:'timeout'}]).companySources,'tools-unavailable');
 assert.equal(answerAuthority([{readPerformed:true,sourceKind:'validated-ordering-calculation'}]).readSources,0);
});
test('existing quick greetings invite a need without demanding a model, and thanks can end naturally',()=>{
 const {quickSocialReply}=require('../model-adapter/conversation-tone.cjs');
 assert(!quickSocialReply('你好').includes('告诉我型号'));assert.match(quickSocialReply('谢谢'),/不客气/);assert(!quickSocialReply('谢谢').includes('现场问题'));
});
