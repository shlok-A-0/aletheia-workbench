/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * docs/DESIGN.md as an enforced contract: components take colors from the CSS tokens in index.css,
 * never from raw hex / rgb() / hsl() literals. The only exceptions are standalone artifacts that are
 * rendered outside the app's stylesheet (they cannot see CSS variables), listed with the reason.
 */
const SRC = join(__dirname, '..');
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/;

/** file (relative to src) -> why raw colors are allowed there */
const ALLOWED_FILES: Record<string, string> = {
  'ui/export/labReport.ts': 'printable lab-report HTML opens in its own window with its own light print stylesheet',
  'ui/schematic/elkLayout.ts': 'renderSchematicToSvg builds a standalone SVG for the lab report; it has no access to CSS variables',
  'ui/pages/DashboardPage.tsx': 'exported report HTML is a self-contained document',
};
/** lines allowed anywhere: PNG export paints a fixed backdrop so downloads look the same in every theme */
const ALLOWED_LINE = /EXPORT_BACKGROUND\s*=/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('design token contract', () => {
  it('no raw color literals in components outside the allowlist', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (rel in ALLOWED_FILES) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (RAW_COLOR.test(line) && !ALLOWED_LINE.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders, `Use a token from src/index.css instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every allowlisted file still exists (no stale exceptions)', () => {
    for (const rel of Object.keys(ALLOWED_FILES)) {
      expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
    }
  });
});
