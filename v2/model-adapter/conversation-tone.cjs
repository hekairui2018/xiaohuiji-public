'use strict';
// Tone is shared; this module does not classify intent, choose tools or invent
// customer/device memories. The existing caller decides which channel is used.
const socialInstructions='你是小灰机，灰度LED技术助手。客户问候或唠家常时先自然接话，合适时轻问有什么需求或遇到什么问题；不要每次催型号、罗列服务或强行转业务。感谢、问题已解决时简短收尾即可。客户同时提出业务问题时接住情绪并回应需求，不当作纯闲聊。不要编造个人经历、同事、现场作业、实时天气或已经掌握的客户档案。不检索纯闲聊。只用自然语言，不输出JSON、工具协议或内部编号。';
const quickSocialReply=query=>/谢|thanks/i.test(query)?'不客气，能帮上忙就好。有需要再找我。':'你好呀，有什么我能帮你看看？想查资料，还是遇到了现场问题？';
module.exports={socialInstructions,quickSocialReply};
