// Local preview server for dist/. Listens on 127.0.0.1 only.
//
// Usage:
//   node scripts/serve.mjs [--prefix /POV_Exchange] [--port 8080]
//
// --prefix mimics the GitHub Pages project URL, so a wrong absolute path in
// the site shows up locally instead of only after deploy.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// --dir lets you preview another build output (for example a test fixture).
const distDir = resolve(arg('--dir', join(root, 'dist')));

const prefix = arg('--prefix', '').replace(/\/+$/, '');
const port = Number(arg('--port', '8080'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('serve: invalid --port');
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error('serve: dist/ not found. Run: node scripts/build.mjs');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function sendFile(res, file, status = 200) {
  res.writeHead(status, {
    'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request');

  if (prefix) {
    if (pathname !== prefix && !pathname.startsWith(prefix + '/')) {
      return send(res, 404, `Not found. This server serves under ${prefix}/`);
    }
    pathname = pathname.slice(prefix.length) || '/';
  }

  let file = resolve(join(distDir, normalize(pathname)));
  if (file !== distDir && !file.startsWith(distDir + sep)) return send(res, 403, 'Forbidden');

  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { location: `${prefix}${pathname}/` });
      return res.end();
    }
    file = join(file, 'index.html');
  }

  if (existsSync(file) && statSync(file).isFile()) return sendFile(res, file);

  const notFound = join(distDir, '404.html');
  if (existsSync(notFound)) return sendFile(res, notFound, 404);
  send(res, 404, 'Not found');
}).listen(port, '127.0.0.1', () => {
  console.log(`serve: http://127.0.0.1:${port}${prefix || ''}/`);
});
