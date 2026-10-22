'use strict';
// One exact public surface. This list never includes internal evidence/model APIs.
const publicGetRoutes=new Set(['/','/wiki','/index.html','/app.js','/styles.css','/v2-components.js','/v2-site-compat.js','/site-compat.js','/img/mascot-iron.png','/product-resources.js','/product-card.js','/session-id.js','/chat-controller.js','/video-groups.js','/api/search','/api/software','/api/videos','/api/docs']);
publicGetRoutes.add('/huiai');
publicGetRoutes.add('/public-client.js');
publicGetRoutes.add('/api/ai/capabilities');
const publicPostRoutes=new Set(['/api/ai/chat']);
module.exports={publicGetRoutes,publicPostRoutes};
