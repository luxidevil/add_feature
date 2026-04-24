const BASE = '/api';

function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...getHeaders(), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    Object.assign(err, data);
    throw err;
  }
  return data;
}

export async function apiStream(path, opts = {}, onResult, onProgress) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...getHeaders(), ...(opts.headers || {}) },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('ndjson') === -1) {
    const data = await res.json();
    if (data.results) {
      data.results.forEach((r, i) => {
        onResult(r);
        onProgress?.(i + 1, data.results.length, 0);
      });
    }
    return { results: data.results || [], newCredits: data.newCredits };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const results = [];
  let newCredits = 0;
  let buf = '';
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.__done) { newCredits = obj.newCredits; continue; }
        if (obj.__error) { streamError = obj.error || 'Stream error'; continue; }
        if (obj.__total) { onProgress?.(-1, obj.__total, 0); continue; }
        const active = obj.__active || 0;
        delete obj.__active;
        results.push(obj);
        onResult(obj);
        onProgress?.(results.length, null, active);
      } catch {}
    }
  }
  buf += dec.decode();
  if (buf.trim()) {
    try {
      const obj = JSON.parse(buf);
      if (obj.__done) newCredits = obj.newCredits;
      else if (obj.__error) streamError = obj.error || 'Stream error';
      else {
        delete obj.__active;
        results.push(obj);
        onResult(obj);
      }
    } catch {}
  }

  if (streamError) throw new Error(streamError);
  return { results, newCredits };
}
