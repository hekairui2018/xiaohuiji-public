'use strict';
const {createOrderingAudit}=require('./ordering.cjs');
const {createAftersalesAudit}=require('./aftersales.cjs');
function createAcceptance({dataset,knowledge}){return {ordering:createOrderingAudit(dataset,knowledge),aftersales:createAftersalesAudit(knowledge)};}
module.exports={createAcceptance};
