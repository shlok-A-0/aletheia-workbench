/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_DIR = __dirname;
const PREFIXES = ['dp', 'u', 'sd', 'dmx', 'wb', 'sch', 'ff', 'msi', 'shell'];
const TOKEN = new RegExp(`^(${PREFIXES.join('|')})-[a-z0-9-]+$`);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('stylesheet coverage', () => {
  it('every dp-/u-/sd-/dmx-/wb-/… class used in a component has a CSS rule', () => {
    const files = walk(UI_DIR);
    const css = [...files, join(UI_DIR, '..', 'index.css'), join(UI_DIR, '..', 'App.css')]
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const used = new Set<string>();
    const attr = /(?:className|class)=(?:"([^"]*)"|\{`([^`]*)`\}|'([^']*)')/g;
    for (const f of files.filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(attr)) {
        const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const tok of text.split(/\s+/)) if (TOKEN.test(tok)) used.add(tok);
      }
    }
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![A-Za-z0-9_-])`).test(css));
    expect(missing).toEqual([]);
  });
});
