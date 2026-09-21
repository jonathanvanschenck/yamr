import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, slugify, isMarkdownPath, extractTitle } from '../src/render.js';

test('headings get GitHub-style ids and deduplicate', () => {
  const { html } = renderMarkdown('# Hello World\n\n## Hello World\n');
  assert.match(html, /<h1 id="hello-world">/);
  assert.match(html, /<h2 id="hello-world-1">/);
});

test('slugify strips punctuation and joins words with dashes', () => {
  assert.equal(slugify('Foo, Bar & Baz!'), 'foo-bar-baz');
  assert.equal(slugify('  Spaced   out '), 'spaced-out');
});

test('hash changes with content', () => {
  assert.notEqual(renderMarkdown('a').hash, renderMarkdown('b').hash);
  assert.equal(renderMarkdown('a').hash, renderMarkdown('a').hash);
});

test('title comes from the first h1', () => {
  assert.equal(extractTitle('intro\n\n# The *Title*\n\n# Second'), 'The Title');
  assert.equal(extractTitle('no heading'), null);
});

test('markdown extensions are detected', () => {
  assert.ok(isMarkdownPath('/a/b.md'));
  assert.ok(isMarkdownPath('/a/B.MARKDOWN'));
  assert.ok(!isMarkdownPath('/a/b.txt'));
  assert.ok(!isMarkdownPath('/a/README'));
});

test('fenced code is syntax highlighted', () => {
  const { html } = renderMarkdown('```js\nconst x = 1;\n```\n');
  assert.match(html, /<code class="hljs language-js">/);
  assert.match(html, /<span class="hljs-keyword">const<\/span>/);
  const plain = renderMarkdown('```nosuchlang\n<b>\n```\n').html;
  assert.match(plain, /class="hljs language-nosuchlang"/);
  assert.match(plain, /&lt;b&gt;/);
});
