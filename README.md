# obsidian-mcp

A filesystem-backed MCP server exposing an Obsidian vault over stdio JSON-RPC.

Registered with Craft Agent via
`~/.craft-agent/workspaces/my-workspace/sources/obsidian/config.json`, which
launches it as `node /Users/GuyG/.claude/obsidian-mcp/server.mjs`.

## Vault

The vault root is hardcoded at the top of `server.mjs`:

```js
const VAULT = '/Users/GuyG/Documents/Obsidian/Vault';
```

Every tool resolves paths through `safePath()`, which rejects any path escaping
the vault root. Changing vaults means editing that constant.

## Requirements

- **Node.js** — the server is an ES module (`.mjs`); developed against Node 25.
- **ripgrep** — required by `search_notes` only. Install with:

  ```sh
  brew install ripgrep
  ```

`findRg()` resolves the binary in this order:

1. `/opt/homebrew/bin/rg`
2. `/usr/local/bin/rg`
3. the copy vendored inside `Craft Agents.app` (`@vscode/ripgrep`)
4. `command -v rg` on `PATH`

If none resolve, `search_notes` raises a clear error naming the install
command. The other seven tools use only Node's `fs` and work without ripgrep.

Note that candidates 3 and 4 live inside third-party package trees and can
disappear when those packages update — this has already broken the server once
(see `CHANGELOG.md`). A Homebrew install at candidate 1 is the stable option.

## Tools

### Read

| Tool | Description |
|---|---|
| `list_notes` | List markdown notes, optionally under a folder prefix. `limit` default 50. |
| `read_note` | Read a note by vault-relative path. Appends `.md` if omitted. |
| `search_notes` | Full-text search via ripgrep. `limit` caps **total** results. |
| `list_folders` | List top-level folders, or children of a given path. |
| `vault_stats` | Note count, total bytes, total MB. |

### Write

| Tool | Description |
|---|---|
| `create_note` | Create a note. Refuses to overwrite unless `overwrite=true`. |
| `append_to_note` | Append text; creates the note if missing. |
| `replace_in_note` | Exact-string replace. Fails if `old_text` is absent or ambiguous. |

## Notes on `search_notes`

- `limit` is a cap on **total** results across the whole search, not per file.
  When results are truncated the response reports the true match count.
- Results are vault-relative, consistent with `list_notes`.
- The query is passed to ripgrep as an argv element with no shell involved, so
  it is matched literally. Shell metacharacters are not expanded, and a leading
  `-` will not be parsed as a flag.
- Queries matching a very large share of the vault can still exceed the output
  buffer; the error suggests narrowing the term or scoping with `path`.

## Manual testing

The server speaks newline-delimited JSON-RPC on stdin/stdout, so it can be
driven directly:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node server.mjs
```

Swap the third line for a `tools/call` to exercise an individual tool:

```sh
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_notes","arguments":{"query":"propofol","limit":3}}}'
```

Syntax-check after editing:

```sh
node --check server.mjs
```
