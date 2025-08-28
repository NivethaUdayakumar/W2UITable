// server.js — zero-dep static server
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8000;
const PUB  = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.csv':  'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function safeServe(absRoot, relReqPath, res) {
  const abs = path.join(absRoot, relReqPath);
  if (!abs.startsWith(absRoot)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  });
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/' || urlPath === '/index.html') {
    safeServe(PUB, 'index.html', res);
    return;
  }

  // Serve data files from /data/*
  if (urlPath.startsWith('/data/')) {
    const rel = urlPath.slice('/data/'.length);
    safeServe(DATA, rel, res);
    return;
  }

  // Otherwise serve from /public/*
  const rel = urlPath.replace(/^\//, '');
  safeServe(PUB, rel, res);
}).listen(PORT, () => {
  console.log(`Serving http://localhost:${PORT}`);
});
