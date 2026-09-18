# Changelog

All notable changes to this MCP server.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.1] — 2026-09-18

Repairs `search_notes`, which was entirely non-functional. Two further defects
were hidden behind the first and only became visible once searches could run.

### Fixed

- **`search_notes` could not locate ripgrep, so every search failed.**
  `findRg()` checked three hardcoded paths, all of which missed, then returned
  the bare string `'rg'`. With no ripgrep on `PATH`, every call failed with
  ``/bin/sh: rg: command not found`` surfaced as a *successful* tool result
  containing an error string.

  The stale candidate pointed at the Anthropic Agent SDK's vendored ripgrep
  (`@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-darwin/rg`). Craft
  Agents has since switched to `@vscode/ripgrep`, so the path no longer exists.

  The candidate list now points at `@vscode/ripgrep` and falls back to a
  `command -v rg` lookup on `PATH`. When nothing resolves, `findRg()` returns
  `null` and `search_notes` throws an error naming the install command rather
  than deferring an opaque failure to every call.

  Resolved operationally by installing ripgrep via Homebrew, which provides
  `/opt/homebrew/bin/rg` — already the first candidate.

- **`limit` capped matches per file rather than in total.** Ripgrep's
  `--max-count` is a per-file limit. Passing the caller's `limit` straight to
  it returned up to `limit × (number of matching files)` lines, against a vault
  of ~15,700 notes. A search scoped to one folder with `limit: 3` returned
  roughly 120 lines. The total cap is now enforced in JavaScript, and truncated
  responses report the true match count.

- **Common terms overflowed the output buffer.** A consequence of the above:
  an unscoped search for a frequent word exceeded the 2 MB `maxBuffer` and
  failed with `ENOBUFS`. The buffer is now 64 MB, per-line width is bounded via
  `--max-columns`, and `ENOBUFS` is caught and reported with guidance to narrow
  the query or scope it with `path`.

### Changed

- **`execSync` replaced with `execFileSync` throughout.** The ripgrep
  invocation was previously assembled as a shell string with hand-rolled
  single-quote escaping. It now passes an argv array with no shell involved, so
  the query needs no escaping and cannot be interpreted as shell syntax. A `--`
  separator prevents a query beginning with `-` being parsed as a flag.

- **`search_notes` returns vault-relative paths**, consistent with
  `list_notes`. Previously absolute.

- **Errors propagate as MCP errors** (`isError: true`) instead of being
  returned as ordinary text content, so clients can distinguish failure from a
  legitimate result.

### Verified

| Case | Result |
|---|---|
| Common term, `limit: 3` | 3 results + `showing 3 of 259+ matches` |
| Folder-scoped, `limit: 3` | 3 results + `showing 3 of 105+ matches` |
| Nonexistent term | `(no matches)` |
| Query with `$HOME`, backticks, quotes, leading `--` | matched literally; no expansion or flag injection |
| `path: "../../../etc"` | `Error: path escapes vault` |
| `vault_stats`, `list_notes`, `read_note` | unchanged |

## [0.2.0] — 2026-04-20

Rewritten as a filesystem-backed server. The previous implementation shelled
out to `/Applications/Obsidian.app/Contents/MacOS/Obsidian`, which is a GUI
binary with no CLI interface. Preserved as `server.mjs.broken-backup`.
