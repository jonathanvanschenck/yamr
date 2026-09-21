# yamr

Yet Another Markdown Renderer. A small local server that shows a markdown file in your browser and updates the page when the file changes.

## Install

Run it from a clone of this repository:

```sh
npm install
npm link
```

After `npm link`, the `yamr` command is on your PATH. Or run it without linking:

```sh
node bin/yamr.js FILE.md
```

## Use

```sh
yamr README.md
```

This starts a server on `http://127.0.0.1:4242`, opens your browser, and shows `README.md`. If you give a directory, yamr shows its `README.md` or a file listing. If you give no path, yamr uses the current directory.

Options:

- `-p, --port <n>`: port to listen on. The default is 4242. If that port is busy, yamr picks a free one.
- `-H, --host <h>`: address to bind. The default is `127.0.0.1`.
- `-n, --no-open`: do not open a browser.
- `-h, --help`: show help.
- `-v, --version`: show the version.

## How it works

The URL path mirrors the file system. The page for `/home/me/notes/todo.md` is `http://127.0.0.1:4242/home/me/notes/todo.md`. Because of this, relative links in a document (for example `[spec](../spec.md)`) resolve to the right file with no rewriting. Absolute links (`/home/me/other.md`) and `file://` links open in the viewer too. Links to images and other files are served as raw files. Add `?raw` to a markdown URL to see its source.

The server watches the parent directory of each open file. When the file changes, the server sends the new HTML to the page over a server-sent events stream. The page merges the new HTML into the current DOM with `morphdom`, so only the blocks that changed are replaced. Before the merge, the page records which element sits at the top of the viewport. After the merge, it scrolls so that element is back where it was. If you are at the end of the document, the page stays at the end.

If the file does not exist yet, the page waits and renders it when it appears.

## Development

```sh
npm test
```

## Notes

The server binds to localhost only, and it serves any file the user can read. Do not bind it to a public address.
