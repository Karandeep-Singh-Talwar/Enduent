import { createServer } from 'node:http';
import { CONFIG } from './config.js';
import { rejectReason, safeDecode } from './guards.js';
import { sendJson, sendStatic } from './http.js';
import { log } from './log.js';
import { handleApi, handleGeo, handleHealth, handleSamples } from './routes.js';

async function route(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  const rejected = rejectReason({ method: req.method, host: req.headers.host, pathname, explorerHeader: req.headers['x-explorer'] });
  if (rejected) return sendJson(res, rejected.status, { ok: false, error: rejected.error });

  if (pathname === '/api/health') return handleHealth(res);
  if (pathname.startsWith('/api/')) return handleApi(res, pathname.slice('/api/'.length), searchParams);
  if (pathname.startsWith('/local/geo/')) return handleGeo(res, pathname.slice('/local/geo/'.length), searchParams);
  if (pathname === '/local/samples') return handleSamples(res, null);
  if (pathname.startsWith('/local/samples/')) {
    const name = safeDecode(pathname.slice('/local/samples/'.length));
    return name === null ? sendJson(res, 400, { ok: false, error: 'bad sample name' }) : handleSamples(res, name);
  }
  if (pathname.startsWith('/shared/')) return sendStatic(res, CONFIG.sharedDir, pathname.slice('/shared/'.length));
  return sendStatic(res, CONFIG.publicDir, pathname === '/' ? 'index.html' : pathname.slice(1));
}

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    log.error('unhandled request error', { url: req.url, message: error?.message });
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
    else res.end();
  }
});

server.on('error', (error) => {
  log.error('server failed to start', { code: error.code, message: error.message });
  process.exit(1);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  log.info(`QC API Explorer running at http://localhost:${CONFIG.port}`, {
    keyConfigured: Boolean(CONFIG.apiKey),
    ...(CONFIG.keyProblem ? { keyProblem: CONFIG.keyProblem } : {}),
  });
});
