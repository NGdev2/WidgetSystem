// Talks to the Python core: JSON API over POST, events over SSE.
const params = new URLSearchParams(location.search);
export const TOKEN = params.get('token') || '';
export const HOST = params.get('host') || 'browser';

export async function call(method, payload = {}) {
  const res = await fetch('/api/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-WS-Token': TOKEN },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.result;
}

export function listen(handler) {
  const es = new EventSource('/events?token=' + encodeURIComponent(TOKEN));
  es.onmessage = (e) => {
    try {
      const { type, data } = JSON.parse(e.data);
      handler(type, data);
    } catch (err) {
      console.error('bad event', err);
    }
  };
  return es;
}

export function log(level, message, source = 'shell') {
  call('log', { level, message: String(message), source }).catch(() => {});
}
