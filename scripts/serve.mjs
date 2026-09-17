import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const requestedPort = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function isInsideRoot(candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requestPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let candidate = normalize(join(root, requestPath));
  if (isInsideRoot(candidate) && existsSync(candidate) && statSync(candidate).isDirectory()) {
    candidate = normalize(join(candidate, 'index.html'));
  }
  if (!isInsideRoot(candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': mime[extname(candidate)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(candidate).pipe(response);
});

server.listen(requestedPort, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`SERVER_URL=http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
