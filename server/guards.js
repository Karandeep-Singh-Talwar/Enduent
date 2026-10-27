// Request guards for a local server that holds a paid API key.

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Blocks DNS rebinding: only requests addressed to a loopback name are served.
 * @param {string | undefined} hostHeader
 * @returns {boolean}
 */
export function isLocalHost(hostHeader = '') {
  const hostname = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0];
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

const isDataPath = (pathname) => pathname.startsWith('/api/') || pathname.startsWith('/local/');

/**
 * @param {{ method?: string, host?: string, pathname: string, explorerHeader?: string | string[] }} req
 * @returns {null | { status: number, error: string }} null when the request may proceed
 */
export function rejectReason({ method, host, pathname, explorerHeader }) {
  if (!isLocalHost(host)) return { status: 421, error: 'local access only' };
  if (method !== 'GET') return { status: 405, error: 'GET only' };
  // A custom header forces a CORS preflight for cross-site callers, which this server never approves.
  // Stops other websites from spending credits via <img src="http://127.0.0.1:8787/api/...">.
  if (isDataPath(pathname) && explorerHeader !== '1') return { status: 403, error: 'missing X-Explorer header' };
  return null;
}

/**
 * decodeURIComponent that returns null instead of throwing on malformed % sequences.
 * @param {string} value
 * @returns {string | null}
 */
export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
