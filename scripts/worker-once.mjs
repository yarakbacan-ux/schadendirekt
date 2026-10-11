// Run from a scheduler; the worker token never appears in output or arguments.
const endpoint = process.env.WORKER_APP_URL;
const token = process.env.WORKER_TOKEN;
if (!endpoint || !token) throw new Error('WORKER_APP_URL_AND_TOKEN_REQUIRED');
const response = await fetch(new URL('/api/internal/import-worker', endpoint), {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(120_000)
});
if (!response.ok) throw new Error(`WORKER_HTTP_${response.status}`);
const result = await response.json();
console.log(JSON.stringify({ processed: result.processed, requestId: result.requestId }));
