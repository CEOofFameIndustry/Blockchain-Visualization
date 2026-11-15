// Звернення до Rust-ядра. Кожна відповідь — повний стан ланцюга з результатами перевірки.

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    body,
    headers: body != null ? { 'Content-Type': 'text/plain; charset=utf-8' } : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text);
}

export const api = {
  chain: () => request('GET', '/api/chain'),
  add: (data) => request('POST', '/api/blocks', data),
  tamper: (index, data) => request('POST', `/api/blocks/${index}/data`, data),
  remine: (index, cascade) => request('POST', `/api/blocks/${index}/mine?cascade=${cascade ? 1 : 0}`),
  difficulty: (value) => request('POST', `/api/difficulty?value=${value}`),
  reset: () => request('POST', '/api/reset'),
};
