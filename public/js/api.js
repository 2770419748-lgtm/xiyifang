export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let unauthorizedHandler = null;
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

function query(params) {
  if (!params) return '';
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) s.append(k, v === true ? '1' : v);
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

async function request(method, url, body) {
  const init = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    // 使用相对路径，部署在子目录下也能正常工作
    res = await fetch(`api${url}`, init);
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试', 0);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    data = await res.json().catch(() => null);
  }
  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status, data);
  }
  return data;
}

export const api = {
  get: (url, params) => request('GET', url + query(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  // 用于下载链接（导出、备份）
  href: (url, params) => `api${url}${query(params)}`,
};
