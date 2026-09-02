// DI token for the resolved `MAX_UPLOAD_BYTES` value, provided by `AppModule`
// from the loaded config so the controller does not import the config loader.
export const MAX_UPLOAD_BYTES = 'MAX_UPLOAD_BYTES';

// DI token for the SSE keep-alive interval (ms). 15s in production; the
// integration suite provides a small value so the delete-detection path can be
// asserted without a 15-second wait.
export const SSE_HEARTBEAT_MS = 'SSE_HEARTBEAT_MS';
