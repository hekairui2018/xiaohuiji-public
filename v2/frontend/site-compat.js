'use strict';
// Single composition root. Static delivery chooses a mode; providers only define factories.
window.addEventListener('DOMContentLoaded', () => {
 const mode=document.body.dataset.client||'rules';
 const provider=mode==='public'?window.PublicClient:mode==='offline'?window.OfflineClient:mode==='local'?window.LocalKnowledgeClient:null;
 if(mode!=='rules'&&!provider)throw Error('Missing V2 request channel: '+mode);
 const channel=provider?provider.create(FrontendApp):{};
 FrontendApp.channel=channel;
 FrontendApp.chat=ChatController.create(FrontendApp,channel);
 if(mode==='offline')ConversationClient.create(FrontendApp,channel);
 Object.freeze(FrontendApp);
}, {once:true});
