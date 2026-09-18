#!/usr/bin/env node
/**
 * Obsidian MCP Server — filesystem-backed (stdio JSON-RPC, newline-delimited)
 *
 * Replaces the prior CLI-wrapper version which failed because
 * /Applications/Obsidian.app/Contents/MacOS/Obsidian is a GUI binary, not a CLI.
 *
 * Tools: list_notes, read_note, search_notes, create_note, append_to_note,
 *        replace_in_note, list_folders, vault_stats.
 *
 * All paths are relative to VAULT and constrained to stay inside it.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, resolve, relative, extname } from 'path';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';

const VAULT = '/Users/GuyG/Documents/Obsidian/Vault';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'obsidian-mcp';
const SERVER_VERSION = '0.2.1';

function safePath(rel) {
  if (rel == null) rel = '';
  if (typeof rel !== 'string') throw new Error('path must be a string');
  const full = resolve(VAULT, rel);
  const r = relative(VAULT, full);
  if (r.startsWith('..') || resolve(VAULT, r) !== full) throw new Error('path escapes vault');
  return full;
}

function findRg() {
  const candidates = [
    '/opt/homebrew/bin/rg',
    '/usr/local/bin/rg',
    '/Applications/Craft Agents.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg',
    '/opt/homebrew/lib/node_modules/happy-coder/tools/unpacked/rg'
  ];
  for (const p of candidates) { try { if (existsSync(p)) return p; } catch {} }
  // Last resort: ask the shell to resolve it on PATH.
  try {
    const found = execFileSync('/usr/bin/env', ['sh', '-c', 'command -v rg'], {
      encoding: 'utf-8'
    }).trim();
    if (found && existsSync(found)) return found;
  } catch {}
  // Do NOT return a bare 'rg' here: that silently defers failure to every
  // search_notes call with an opaque "command not found". Fail loudly instead.
  return null;
}
const RG = findRg();

function ensureMd(rel) {
  return rel.endsWith('.md') ? rel : rel + '.md';
}

function walk(dir, out = [], baseDepth = dir.split('/').length) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, baseDepth);
    else if (entry.isFile() && extname(entry.name) === '.md') out.push(full);
  }
  return out;
}

// ---- Tool implementations ----

const tools = {
  list_notes: {
    description: 'List markdown notes in the vault (optionally filtered by folder prefix).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder prefix relative to vault root (optional)' },
        limit: { type: 'number', default: 50 }
      }
    },
    run({ path = '', limit = 50 }) {
      const base = safePath(path);
      if (!existsSync(base)) return `No such folder: ${path}`;
      const files = walk(base).slice(0, limit).map(f => relative(VAULT, f));
      return files.length ? files.join('\n') : '(no notes found)';
    }
  },

  read_note: {
    description: 'Read a note by its vault-relative path.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    run({ path }) {
      const full = safePath(ensureMd(path));
      return readFileSync(full, 'utf-8');
    }
  },

  search_notes: {
    description: 'Full-text search via ripgrep across vault markdown files.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string', description: 'Folder prefix (optional)' },
        limit: { type: 'number', default: 20 }
      },
      required: ['query']
    },
    run({ query, path = '', limit = 20 }) {
      if (!RG) {
        throw new Error(
          'ripgrep (rg) not found — search_notes is unavailable. Install it with: brew install ripgrep'
        );
      }
      const base = safePath(path);
      const n = Number(limit);
      const max = Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
      // NOTE: rg's -m/--max-count is PER FILE, not a total cap. Passing the
      // caller's limit straight to -m returns up to limit*(file count) lines.
      // We bound per-file output loosely, then enforce the real total in JS.
      // execFileSync with an argv array: no shell, so the query needs no
      // escaping and cannot be interpreted as shell syntax.
      const args = [
        '--no-heading', '--line-number', '--color', 'never',
        '-t', 'md',
        '--max-count', String(max),
        '--max-columns', '500',
        '--max-columns-preview',
        '--', String(query), base
      ];
      let out;
      try {
        out = execFileSync(RG, args, {
          encoding: 'utf-8',
          timeout: 15000,
          maxBuffer: 64 * 1024 * 1024
        });
      } catch (e) {
        // rg exits 1 for "no matches", which is not an error condition.
        if (e.status === 1) return '(no matches)';
        if (e.code === 'ENOBUFS') {
          throw new Error(
            `query '${query}' produced too much output to buffer; narrow it with a more specific term or a 'path' folder scope`
          );
        }
        throw new Error(`ripgrep failed (exit ${e.status ?? '?'}): ${e.stderr || e.message}`);
      }
      const lines = out.split('\n').filter(Boolean);
      if (!lines.length) return '(no matches)';
      // Report vault-relative paths, consistent with list_notes.
      const rel = lines.map(l => (l.startsWith(VAULT + '/') ? l.slice(VAULT.length + 1) : l));
      const shown = rel.slice(0, max);
      const suffix = rel.length > max
        ? `\n\n(showing ${max} of ${rel.length}+ matches; raise 'limit' or narrow 'path')`
        : '';
      return shown.join('\n') + suffix;
    }
  },

  create_note: {
    description: 'Create a new note. Fails if file already exists unless overwrite=true.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        overwrite: { type: 'boolean', default: false }
      },
      required: ['path', 'content']
    },
    run({ path, content, overwrite = false }) {
      const full = safePath(ensureMd(path));
      if (existsSync(full) && !overwrite) return `Exists: ${path} (pass overwrite=true to replace)`;
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
      return `Wrote ${relative(VAULT, full)} (${content.length} chars)`;
    }
  },

  append_to_note: {
    description: 'Append text to an existing note (creates if missing).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    },
    run({ path, content }) {
      const full = safePath(ensureMd(path));
      mkdirSync(dirname(full), { recursive: true });
      const sep = existsSync(full) ? '\n' : '';
      appendFileSync(full, sep + content, 'utf-8');
      return `Appended ${content.length} chars to ${relative(VAULT, full)}`;
    }
  },

  replace_in_note: {
    description: 'Exact-string replace in an existing note. Fails if old_text not found or appears multiple times.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' }
      },
      required: ['path', 'old_text', 'new_text']
    },
    run({ path, old_text, new_text }) {
      const full = safePath(ensureMd(path));
      const body = readFileSync(full, 'utf-8');
      const parts = body.split(old_text);
      if (parts.length === 1) return `old_text not found in ${path}`;
      if (parts.length > 2) return `old_text appears ${parts.length - 1} times; make it unique`;
      writeFileSync(full, parts.join(new_text), 'utf-8');
      return `Replaced 1 occurrence in ${relative(VAULT, full)}`;
    }
  },

  list_folders: {
    description: 'List top-level folders (or children of given path) in the vault.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } }
    },
    run({ path = '' }) {
      const base = safePath(path);
      if (!existsSync(base)) return `No such folder: ${path}`;
      const entries = readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name);
      return entries.join('\n') || '(no subfolders)';
    }
  },

  vault_stats: {
    description: 'Summary: total notes, total folders, total size.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const files = walk(VAULT);
      let bytes = 0;
      for (const f of files) bytes += statSync(f).size;
      return `notes=${files.length} bytes=${bytes} MB=${(bytes / 1024 / 1024).toFixed(2)}`;
    }
  }
};

// ---- JSON-RPC stdio loop (newline-delimited) ----

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function toolsList() {
  return Object.entries(tools).map(([name, t]) => ({
    name, description: t.description, inputSchema: t.inputSchema
  }));
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: toolsList() } });
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    const tool = tools[name];
    if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${name}` } });
    try {
      const out = tool.run(args);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
    }
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); }
  catch (e) { /* ignore parse errors */ }
});
rl.on('close', () => process.exit(0));
