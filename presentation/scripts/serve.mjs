import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PPT_PORT || 32150);
const host = process.env.PPT_HOST || '127.0.0.1';
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.md':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.mp4':'video/mp4' };

// Single byte ranges let browsers seek without buffering the entire video.
function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ([first, last].some(number => number !== null && !Number.isSafeInteger(number))) return null;
  const start = first === null ? Math.max(0, size - last) : first;
  const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
  return start < size && start <= end ? { start, end } : null;
}

export function createStaticServer() {
  return http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(root) || pathname.split('/').some(segment => segment.startsWith('.') || segment === 'node_modules')) { response.writeHead(403).end(); return; }
    const file = await stat(target);
    if (!file.isFile()) { response.writeHead(404).end(); return; }
    const headers = { 'Content-Type':types[path.extname(target)] || 'application/octet-stream', 'Content-Length':file.size, 'Accept-Ranges':'bytes', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' };
    // RFC 9110: a Range header applies to GET, not HEAD.
    const range = request.method === 'GET' && request.headers.range;
    let bounds;
    if (range) {
      bounds = parseRange(range, file.size);
      if (!bounds) { response.writeHead(416, { ...headers, 'Content-Length':0, 'Content-Range':`bytes */${file.size}` }).end(); return; }
      headers['Content-Range'] = `bytes ${bounds.start}-${bounds.end}/${file.size}`;
      headers['Content-Length'] = bounds.end - bounds.start + 1;
    }
    response.writeHead(bounds ? 206 : 200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    await pipeline(createReadStream(target, bounds), response);
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(error.code === 'ENOENT' || error instanceof URIError ? 404 : 500).end('Unable to serve file');
  }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createStaticServer();
  server.listen(port, host, () => console.log(`New Babel keynote: http://${host}:${server.address().port}`));
}
