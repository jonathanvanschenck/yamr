#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { createServer, fsPathToUrl } from '../src/server.js';
import { openInBrowser } from '../src/open.js';

const HELP = `Usage: yamr [file-or-directory] [options]

Renders a markdown file in your browser and updates the view when the file changes.
Links to other local files open in the same viewer.

Options:
  -p, --port <n>   Port to listen on (default: 4242, falls back to a free port)
  -H, --host <h>   Host to bind (default: 127.0.0.1)
  -n, --no-open    Do not open a browser window
  -h, --help       Show this help
  -v, --version    Show the version
`;

let values;
let positionals;
try {
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p', default: '4242' },
      host: { type: 'string', short: 'H', default: '127.0.0.1' },
      'no-open': { type: 'boolean', short: 'n', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  }));
} catch (err) {
  console.error(err.message);
  console.error(HELP);
  process.exit(2);
}

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const target = path.resolve(positionals[0] || '.');
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid port: ${values.port}`);
  process.exit(2);
}

const server = createServer({ initialPath: target });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port !== 0) {
    console.error(`Port ${port} is in use, picking a free port instead.`);
    server.listen(0, values.host);
    return;
  }
  console.error(err.message);
  process.exit(1);
});

server.listen(port, values.host, () => {
  const address = server.address();
  const host = address.address.includes(':') ? `[${address.address}]` : address.address;
  const url = `http://${host}:${address.port}${fsPathToUrl(target)}`;
  console.log(`yamr serving ${target}`);
  console.log(url);
  if (!values['no-open']) openInBrowser(url);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
