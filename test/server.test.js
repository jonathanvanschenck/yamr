import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, urlToFsPath, fsPathToUrl } from '../src/server.js';

let dir;
let server;
let base;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamr-'));
  await fs.mkdir(path.join(dir, 'sub'));
  await fs.writeFile(path.join(dir, 'main.md'), '# Main\n\n[other](./sub/other.md) [f](file://' + dir + '/sub/other.md)\n');
  await fs.writeFile(path.join(dir, 'sub', 'other.md'), '# Other\n');
  await fs.writeFile(path.join(dir, 'sub', 'README.md'), '# Sub readme\n');
  server = createServer({ initialPath: path.join(dir, 'main.md') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('url and file path conversions round trip', () => {
  assert.equal(urlToFsPath('/home/me/a%20b.md'), '/home/me/a b.md');
  assert.equal(fsPathToUrl('/home/me/a b.md'), '/home/me/a%20b.md');
  assert.equal(urlToFsPath('/C:/Users/me/x.md'), path.normalize('C:/Users/me/x.md'));
  assert.equal(urlToFsPath('/%E0%A4%A'), null);
});

test('root redirects to the initial file', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), fsPathToUrl(path.join(dir, 'main.md')));
});

test('markdown files render as html with file:// links rewritten', async () => {
  const res = await fetch(base + fsPathToUrl(path.join(dir, 'main.md')));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<title>Main<\/title>/);
  assert.match(body, /href="\.\/sub\/other\.md"/);
  assert.match(body, new RegExp(`href="${dir}/sub/other\\.md"`));
  assert.doesNotMatch(body, /file:\/\//);
});

test('raw query returns the source', async () => {
  const res = await fetch(base + fsPathToUrl(path.join(dir, 'main.md')) + '?raw');
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.match(await res.text(), /^# Main/);
});

test('directories redirect to their readme', async () => {
  const res = await fetch(base + fsPathToUrl(path.join(dir, 'sub')) + '/', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), fsPathToUrl(path.join(dir, 'sub', 'README.md')));
});

test('directories without a readme get a listing', async () => {
  const res = await fetch(base + fsPathToUrl(dir) + '/');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /main\.md/);
  assert.match(body, /sub\//);
});

test('missing markdown files get a live 404 page', async () => {
  const res = await fetch(base + fsPathToUrl(path.join(dir, 'nope.md')));
  assert.equal(res.status, 404);
  assert.match(await res.text(), /File not found/);
});

test('events stream sends an update when the file changes', async () => {
  const file = path.join(dir, 'live.md');
  await fs.writeFile(file, '# v1\n');
  const controller = new AbortController();
  const res = await fetch(`${base}/__yamr/events?path=${encodeURIComponent(file)}&hash=none`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readUntil = async (needle) => {
    while (!buffer.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value);
    }
  };
  await readUntil('event: update'); // initial snapshot because hash differs
  await fs.writeFile(file, '# v2\n\nchanged\n');
  await readUntil('changed');
  assert.match(buffer, /"title":"v2"/);
  controller.abort();
});
