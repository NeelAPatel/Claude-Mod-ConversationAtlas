import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { goldenScope, matchesGlob, scopeViolations, tscPrerequisite } from './check.mjs';
import { parseBrief } from './check-brief.mjs';

const goodBrief = `## RESTATE
Need a small script change.
## GOAL
Add one check.
## SCOPE
- scripts/check.mjs
## FORBIDDEN
No other changes.
## GOLDENS
none
## ACCEPTANCE
- It works.
## VERIFY
node scripts/check.mjs
## TIMEBOX
One hour.
## REPORT
Write .claude/atlas/handoffs/example.md
`;

test('brief parser accepts a complete brief', () => {
  const parsed = parseBrief(goodBrief);
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.scope, ['scripts/check.mjs']);
  assert.deepEqual(parsed.goldens, []);
});

test('brief parser reports missing sections, placeholders, and invalid rules', () => {
  const parsed = parseBrief('## GOAL\nTODO <fill this>\n## SCOPE\nNo bullets\n## GOLDENS\nmissing-name\n## VERIFY\nrun it\n## REPORT\nwrite a report\n');
  assert.ok(parsed.problems.some(problem => problem.section === 'RESTATE'));
  assert.ok(parsed.problems.some(problem => problem.section === 'GOAL' && /placeholder/.test(problem.message)));
  assert.ok(parsed.problems.some(problem => problem.section === 'SCOPE'));
  assert.ok(parsed.problems.some(problem => problem.section === 'GOLDENS'));
  assert.ok(parsed.problems.some(problem => problem.section === 'VERIFY'));
  assert.ok(parsed.problems.some(problem => problem.section === 'REPORT'));
});

test('shared scope entries require a shared marker', () => {
  const parsed = parseBrief(goodBrief.replace('- scripts/check.mjs', '- hooks/view.tsx'));
  assert.ok(parsed.problems.some(problem => problem.section === 'SCOPE' && /shared/.test(problem.message)));
});

test('worked example in the template passes the brief checker', () => {
  const template = readFileSync('docs/process/brief-template.md', 'utf8');
  const example = template.slice(template.indexOf('## Worked example'));
  assert.deepEqual(parseBrief(example).problems, []);
});

test('glob matching supports single and recursive wildcards', () => {
  assert.equal(matchesGlob('scripts/a.mjs', 'scripts/*.mjs'), true);
  assert.equal(matchesGlob('scripts/nested/a.mjs', 'scripts/*.mjs'), false);
  assert.equal(matchesGlob('scripts/nested/a.mjs', 'scripts/**/*.mjs'), true);
});

test('scope check reports only paths outside the allow-list', () => {
  const violations = scopeViolations(
    ['scripts/check.mjs', 'scripts/nested/a.mjs', 'hooks/view.tsx'],
    ['scripts/check.mjs', 'scripts/**/*.mjs'],
  );
  assert.deepEqual(violations, ['hooks/view.tsx']);
});

test('golden scope allows named goldens and rejects unexpected changes', () => {
  assert.deepEqual(goldenScope(['tests/golden/desktop-46-map.txt'], ['desktop-46-map']), {
    allowed: ['desktop-46-map'], changed: ['desktop-46-map'], unexpected: [], missing: [],
  });
  const denied = goldenScope(['tests/golden/terminal-80-trail.txt'], ['desktop-46-map']);
  assert.deepEqual(denied.unexpected, ['terminal-80-trail']);
  assert.deepEqual(denied.missing, ['desktop-46-map']);
});

test('tsc prerequisite returns the first missing item, or null when all exist', () => {
  const all = ['package.json', 'tsconfig.json', '.claude-plugin/types/tsconfig.json', 'node_modules/.bin/tsc', 'node_modules/.bin/tsc.cmd'];
  const have = missing => file => all.includes(file) && !missing.includes(file);
  assert.equal(tscPrerequisite(have([]), 'linux'), null);
  assert.equal(tscPrerequisite(have([]), 'win32'), null);
  assert.match(tscPrerequisite(have(['package.json', 'tsconfig.json']), 'linux'), /^missing package\.json/);
  assert.match(tscPrerequisite(have(['tsconfig.json']), 'linux'), /^missing tsconfig\.json/);
  assert.match(
    tscPrerequisite(have(['.claude-plugin/types/tsconfig.json']), 'linux'),
    /^missing \.claude-plugin\/types\/tsconfig\.json \(written when Claude Code loads the mod\)/,
  );
  assert.match(tscPrerequisite(have(['node_modules/.bin/tsc']), 'linux'), /^missing node_modules\/\.bin\/tsc /);
  assert.match(tscPrerequisite(have(['node_modules/.bin/tsc.cmd']), 'win32'), /^missing node_modules\/\.bin\/tsc\.cmd /);
  assert.equal(tscPrerequisite(have(['node_modules/.bin/tsc.cmd']), 'linux'), null);
});

test('JSON report has the required fields and step shape', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'atlas-check-'));
  try {
    const out = path.join(temp, 'result.json');
    const result = spawnSync(process.execPath, [
      'scripts/check.mjs', '--json', '--out', out,
      '--skip', 'validate,test,seam,tsc,scripts,stamp',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    for (const key of ['ok', 'startedAt', 'base', 'head', 'mergeBase', 'branch', 'patchId', 'brief', 'steps', 'counts', 'goldens']) {
      assert.ok(Object.hasOwn(report, key), `missing ${key}`);
    }
    assert.deepEqual(report.steps.map(step => step.name), ['validate', 'test', 'seam', 'tsc', 'scripts', 'golden-scope', 'scope', 'stamp']);
    assert.ok(report.steps.every(step => ['pass', 'fail', 'skip', 'warn'].includes(step.status)));
    assert.deepEqual(Object.keys(report.goldens).sort(), ['allowed', 'changed', 'unexpected']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
