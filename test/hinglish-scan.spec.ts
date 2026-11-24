import * as fs from 'fs';
import * as path from 'path';

describe('Hinglish String Literal Scanner', () => {
  const HINGLISH_KEYWORDS = [
    'aap', 'hai', 'hain', 'nahi', 'nhi', 'kar', 'karo', 'sakte', 'sakta', 'pehle',
    'doosri', 'dusri', 'mein', 'wala', 'wali', 'abhi', 'kyun', 'kya', 'zaroori',
    'galat', 'sahi', 'chahiye', 'baaki', 'dobara', 'bhejo', 'dekho', 'maujood',
    'badal', 'aakhri', 'sirf', 'apna', 'apne', 'apni',
  ];

  const wordBoundaryRegex = new RegExp(
    `\\b(${HINGLISH_KEYWORDS.join('|')})\\b`,
    'i',
  );

  // Technical allowlist for string literals (e.g. paths, external identifiers)
  const ALLOWLIST = new Set<string>([
    // Currently 0 needed, but structure preserved for future technical tokens
  ]);

  function getFilesRecursively(dir: string, extensions: string[]): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getFilesRecursively(fullPath, extensions));
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  function extractStringLiterals(code: string): Array<{ text: string; line: number }> {
    const literals: Array<{ text: string; line: number }> = [];
    // Regular expression matching '...', "...", or `...`
    const regex = /('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`)/g;
    const lines = code.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        // Strip surrounding quotes
        const raw = match[0];
        const inner = raw.slice(1, -1);
        literals.push({ text: inner, line: lineIndex + 1 });
      }
    }

    return literals;
  }

  it('verifies backend src/ contains 0 Hinglish string literals', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const files = getFilesRecursively(srcDir, ['.ts', '.js']);
    const violations: Array<{ file: string; line: number; match: string; text: string }> = [];

    for (const file of files) {
      const code = fs.readFileSync(file, 'utf-8');
      const literals = extractStringLiterals(code);

      for (const { text, line } of literals) {
        if (ALLOWLIST.has(text.trim())) continue;

        const m = text.match(wordBoundaryRegex);
        if (m) {
          violations.push({
            file: path.relative(path.resolve(__dirname, '..'), file),
            line,
            match: m[0],
            text,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('verifies frontend lms-frontend/src/ contains 0 Hinglish string literals', () => {
    const frontendSrcDir = path.resolve(__dirname, '../lms-frontend/src');
    const files = getFilesRecursively(frontendSrcDir, ['.ts', '.tsx', '.js', '.jsx']);
    const violations: Array<{ file: string; line: number; match: string; text: string }> = [];

    for (const file of files) {
      const code = fs.readFileSync(file, 'utf-8');
      const literals = extractStringLiterals(code);

      for (const { text, line } of literals) {
        if (ALLOWLIST.has(text.trim())) continue;

        const m = text.match(wordBoundaryRegex);
        if (m) {
          violations.push({
            file: path.relative(path.resolve(__dirname, '..'), file),
            line,
            match: m[0],
            text,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
