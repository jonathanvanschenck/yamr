import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, isMarkdownPath, escapeHtml } from './render.js';
import { FileWatcher } from './watch.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  '/__yamr/client.js': { file: path.join(HERE, 'client.js'), type: 'text/javascript' },
  '/__yamr/style.css': { file: path.join(HERE, 'style.css'), type: 'text/css' },
  '/__yamr/morphdom.js': { file: require.resolve('morphdom/dist/morphdom-umd.min.js'), type: 'text/javascript' },
  '/__yamr/hljs-light.css': { file: require.resolve('highlight.js/styles/github.min.css'), type: 'text/css' },
  '/__yamr/hljs-dark.css': { file: require.resolve('highlight.js/styles/github-dark.min.css'), type: 'text/css' },
};

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const INDEX_NAMES = ['README.md', 'readme.md', 'Readme.md', 'index.md'];

// Map a URL path to an absolute file system path. The URL path mirrors the
// file system: http://host/home/me/doc.md serves /home/me/doc.md.
export function urlToFsPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:\//.test(decoded)) decoded = decoded.slice(1); // Windows drive letter
  return path.normalize(decoded);
}

export function fsPathToUrl(filePath) {
  const abs = path.resolve(filePath).split(path.sep).join('/');
  const withSlash = abs.startsWith('/') ? abs : `/${abs}`;
  return withSlash.split('/').map(encodeURIComponent).join('/');
}

// Turn file:// links into server links so they open in the same viewer.
function rewriteFileLinks(html) {
  return html.replace(/(href|src)="file:\/\/(?:localhost)?(\/[^"]*)"/g, (_, attr, p) => `${attr}="${p}"`);
}

function page({ title, filePath, html, hash, live }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/__yamr/style.css">
<link rel="stylesheet" href="/__yamr/hljs-light.css" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="/__yamr/hljs-dark.css" media="(prefers-color-scheme: dark)">
</head>
<body data-path="${escapeHtml(live ? filePath : '')}">
<main id="content" class="markdown" data-hash="${hash}">
${html}
</main>
<div id="status" title="${escapeHtml(filePath)}"><span class="dot"></span><span class="label">${escapeHtml(path.basename(filePath))}</span></div>
<script src="/__yamr/morphdom.js"></script>
<script src="/__yamr/client.js"></script>
</body>
</html>`;
}

async function renderFile(filePath) {
  try {
    const source = await fsp.readFile(filePath, 'utf8');
    const { html, hash, title } = renderMarkdown(source);
    return { ok: true, html: rewriteFileLinks(html), hash, title: title || path.basename(filePath) };
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'File not found' : `Cannot read file (${err.code || err.message})`;
    return {
      ok: false,
      html: `<h1>${escapeHtml(reason)}</h1><p><code>${escapeHtml(filePath)}</code></p><p>This page updates itself when the file appears.</p>`,
      hash: `missing-${Date.now()}`,
      title: reason,
    };
  }
}

async function directoryListing(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = [`# ${dirPath}`, '', `- [..](${fsPathToUrl(path.dirname(dirPath))}/)`];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const suffix = entry.isDirectory() ? '/' : '';
    lines.push(`- [${entry.name}${suffix}](${encodeURIComponent(entry.name)}${suffix})`);
  }
  return lines.join('\n');
}

async function isText(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(512), 0, 512, 0);
    return !buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

export function createServer({ initialPath } = {}) {
  const watcher = new FileWatcher();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/__yamr/events') return handleEvents(url, req, res);
      if (ASSETS[url.pathname]) return sendFile(res, ASSETS[url.pathname].file, ASSETS[url.pathname].type);
      if (url.pathname === '/' && initialPath) return redirect(res, fsPathToUrl(initialPath));

      const filePath = urlToFsPath(url.pathname);
      if (!filePath) return sendText(res, 400, 'Bad path');

      let stat = null;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        // Missing markdown files still get a live page so they show up once created.
        if (isMarkdownPath(filePath)) return sendMarkdownPage(res, filePath, 404);
        return sendText(res, 404, `Not found: ${filePath}`);
      }

      if (stat.isDirectory()) {
        if (!url.pathname.endsWith('/')) return redirect(res, `${url.pathname}/`);
        for (const name of INDEX_NAMES) {
          const candidate = path.join(filePath, name);
          if (fs.existsSync(candidate)) return redirect(res, fsPathToUrl(candidate));
        }
        const { html, hash } = renderMarkdown(await directoryListing(filePath));
        return sendHtml(res, 200, page({ title: filePath, filePath, html, hash, live: false }));
      }

      if (isMarkdownPath(filePath) && !url.searchParams.has('raw')) return sendMarkdownPage(res, filePath, 200);

      const ext = path.extname(filePath).toLowerCase();
      let type = MIME[ext];
      if (!type) type = (await isText(filePath)) ? 'text/plain' : 'application/octet-stream';
      return sendFile(res, filePath, type, stat.size);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendText(res, 500, `Server error: ${err.message}`);
      else res.end();
    }
  });

  async function sendMarkdownPage(res, filePath, status) {
    const { html, hash, title } = await renderFile(filePath);
    sendHtml(res, status, page({ title, filePath, html, hash, live: true }));
  }

  function handleEvents(url, req, res) {
    const filePath = urlToFsPath(url.searchParams.get('path') || '');
    if (!filePath) return sendText(res, 400, 'Missing path');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    let lastHash = url.searchParams.get('hash') || null;
    let pending = null;
    const push = async () => {
      // Coalesce bursts: if a render is running, run once more after it.
      if (pending) return (pending.again = true);
      pending = { again: false };
      do {
        pending.again = false;
        const result = await renderFile(filePath);
        if (result.hash !== lastHash || !result.ok) {
          lastHash = result.hash;
          res.write(`event: update\ndata: ${JSON.stringify(result)}\n\n`);
        }
      } while (pending.again);
      pending = null;
    };

    const unsubscribe = watcher.subscribe(filePath, push);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    push(); // Catch changes made between page load and subscription.
  }

  server.on('close', () => watcher.close());
  return server;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function sendFile(res, filePath, type, size) {
  const headers = { 'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type, 'Cache-Control': 'no-store' };
  if (size !== undefined) headers['Content-Length'] = size;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).on('error', () => res.end()).pipe(res);
}
