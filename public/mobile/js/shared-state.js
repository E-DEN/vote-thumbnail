// mobile/js/shared-state.js
// app.js / reaction.js 間で共有する状態

export let _suppressHistory = false;
export function setSuppressHistory(v) { _suppressHistory = v; }
