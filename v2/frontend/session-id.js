'use strict';
// getRandomValues also works on LAN HTTP, where randomUUID may be unavailable.
window.createV2SessionId = () => {
 const bytes = crypto.getRandomValues(new Uint8Array(16));
 return 'w-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};
