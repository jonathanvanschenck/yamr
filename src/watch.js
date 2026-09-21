import fs from 'node:fs';
import path from 'node:path';

// Watches files by watching their parent directory. This survives editors that
// save with a rename (write a temp file, then move it over the original), which
// would break a watcher attached to the file itself.
export class FileWatcher {
  #dirs = new Map(); // dir -> { watcher, files: Map<filePath, Set<listener>> }
  #timers = new Map(); // filePath -> debounce timer

  subscribe(filePath, listener) {
    filePath = path.resolve(filePath);
    const dir = path.dirname(filePath);
    let entry = this.#dirs.get(dir);
    if (!entry) {
      entry = { watcher: null, files: new Map() };
      try {
        entry.watcher = fs.watch(dir, { persistent: false }, (event, name) => {
          if (!name) return;
          const changed = path.join(dir, name.toString());
          if (entry.files.has(changed)) this.#notify(changed);
        });
        entry.watcher.on('error', () => {});
      } catch {
        // Directory may not exist yet; fall back to polling the file itself.
        entry.watcher = null;
      }
      this.#dirs.set(dir, entry);
    }
    let listeners = entry.files.get(filePath);
    if (!listeners) {
      listeners = new Set();
      entry.files.set(filePath, listeners);
      if (!entry.watcher) fs.watchFile(filePath, { interval: 500 }, () => this.#notify(filePath));
    }
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      entry.files.delete(filePath);
      if (!entry.watcher) fs.unwatchFile(filePath);
      if (entry.files.size === 0) {
        entry.watcher?.close();
        this.#dirs.delete(dir);
      }
    };
  }

  #notify(filePath) {
    clearTimeout(this.#timers.get(filePath));
    this.#timers.set(filePath, setTimeout(() => {
      this.#timers.delete(filePath);
      const entry = this.#dirs.get(path.dirname(filePath));
      const listeners = entry?.files.get(filePath);
      if (!listeners) return;
      for (const listener of listeners) listener(filePath);
    }, 60));
  }

  close() {
    for (const [dir, entry] of this.#dirs) {
      entry.watcher?.close();
      if (!entry.watcher) for (const file of entry.files.keys()) fs.unwatchFile(file);
      this.#dirs.delete(dir);
    }
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}
