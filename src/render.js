import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import { createHash } from 'node:crypto';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn']);

export function isMarkdownPath(filePath) {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return MARKDOWN_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

// Build a URL-safe id from heading text, like GitHub does.
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function createMarked() {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use(markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }));
  let seen;
  marked.use({
    hooks: {
      preprocess(src) {
        seen = new Map();
        return src;
      },
    },
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(inner) || 'section';
        const count = seen.get(id) || 0;
        seen.set(id, count + 1);
        if (count > 0) id = `${id}-${count}`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
    },
  });
  return marked;
}

const marked = createMarked();

export function renderMarkdown(source) {
  const html = marked.parse(source);
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 16);
  return { html, hash, title: extractTitle(source) };
}

export function extractTitle(source) {
  const match = source.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].replace(/[*_`]/g, '') : null;
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
