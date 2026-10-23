'use strict';
// One exact public surface. This list never includes internal evidence/model APIs.
const publicGetRoutes=new Set(['/','/wiki','/index.html','/app.js','/styles.css','/v2-components.js','/v2-site-compat.js','/site-compat.js','/img/mascot-iron.png','/product-resources.js','/product-card.js','/session-id.js','/chat-controller.js','/video-groups.js','/api/search','/api/software','/api/videos','/api/docs']);
publicGetRoutes.add('/huiai');
publicGetRoutes.add('/public-client.js');
publicGetRoutes.add('/api/ai/capabilities');
const publicPostRoutes=new Set(['/api/ai/chat']);
for(const route of ['/api/public-search','/api/public-context','/public-search.js','/img/software-screen-control.png'])publicGetRoutes.add(route);
const isPublicRoute=(method,route)=>method==='POST'&&(route==='/api/huidu/log'||publicPostRoutes.has(route))||method==='GET'&&publicGetRoutes.has(route)||['GET','HEAD'].includes(method)&&/^\/public-files\/[a-f0-9]{64}\/[^/]+$/.test(route);
module.exports={publicGetRoutes,publicPostRoutes,isPublicRoute};
