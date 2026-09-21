/* global morphdom */
(() => {
  const content = document.getElementById('content');
  const status = document.getElementById('status');
  const filePath = document.body.dataset.path;
  let hash = content.dataset.hash;

  function setStatus(state) {
    status.dataset.state = state;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.height > 0;
  }

  function firstVisibleChild(parent) {
    for (const el of parent.children) if (isVisible(el)) return el;
    return null;
  }

  // Remember which elements sit at the top of the viewport so the page can be
  // scrolled back to them after the DOM changes. Candidates are ordered from
  // most specific to least: the innermost visible element, its ancestors up to
  // the top-level block, then nearby top-level blocks. Whichever survives the
  // update is used.
  function captureAnchor() {
    const doc = document.documentElement;
    const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
    const candidates = [];
    const remember = (el) => candidates.push({ el, top: el.getBoundingClientRect().top });

    const block = firstVisibleChild(content);
    if (block) {
      const chain = [];
      let el = block;
      while (el) {
        chain.unshift(el);
        el = firstVisibleChild(el);
      }
      chain.forEach(remember);
      let next = block.nextElementSibling;
      for (let i = 0; next && i < 4; i++, next = next.nextElementSibling) remember(next);
      let prev = block.previousElementSibling;
      for (let i = 0; prev && i < 2; i++, prev = prev.previousElementSibling) remember(prev);
    }
    return { atBottom, candidates };
  }

  function restoreAnchor({ atBottom, candidates }) {
    if (atBottom) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }
    const anchor = candidates.find((c) => c.el.isConnected);
    if (!anchor) return;
    const delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (delta) window.scrollBy(0, delta);
  }

  function djb2(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // Key each top-level block by its content so morphdom keeps unchanged blocks
  // (and the user's scroll position) even when blocks are added or removed above.
  function keyBlocks(parent) {
    const seen = new Map();
    for (const el of parent.children) {
      const html = el.outerHTML.replace(/ data-key="[^"]*"/, '');
      let key = djb2(html);
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      if (n) key += `-${n}`;
      el.dataset.key = key;
    }
  }

  function apply(update) {
    if (update.hash === hash) return;
    hash = update.hash;
    const anchor = captureAnchor();
    const next = document.createElement('div');
    next.innerHTML = update.html;
    keyBlocks(content);
    keyBlocks(next);
    morphdom(content, next, {
      childrenOnly: true,
      getNodeKey(node) {
        return node.nodeType === 1 ? node.dataset.key || node.id : undefined;
      },
      onBeforeElUpdated(from, to) {
        return !from.isEqualNode(to);
      },
    });
    content.dataset.hash = hash;
    if (update.title) document.title = update.title;
    restoreAnchor(anchor);
  }

  function connect() {
    const source = new EventSource(`/__yamr/events?path=${encodeURIComponent(filePath)}&hash=${encodeURIComponent(hash)}`);
    source.addEventListener('open', () => setStatus('live'));
    source.addEventListener('error', () => setStatus('offline'));
    source.addEventListener('update', (event) => {
      try {
        apply(JSON.parse(event.data));
      } catch (err) {
        console.error('yamr: bad update', err);
      }
    });
  }

  if (filePath) {
    connect();
  } else {
    status.hidden = true;
  }

  // Scroll to the hash target once fonts and images have settled.
  window.addEventListener('load', () => {
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  });
})();
