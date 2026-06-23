// Browser/extension shim so supabase-js does not try to import the Node "ws" package.
export default typeof WebSocket !== "undefined" ? WebSocket : class WebSocketShim {};
