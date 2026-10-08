import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseBrief } from './check-brief.mjs';

const STEP_NAMES = ['validate', 'test', 'seam', 'tsc', 'scripts', 'golden-scope', 'scope', 'stamp'];
const DEFAULT_OUT = '.claude/atlas/tmp/check.json';

export function globToRegex(glob) {
  let pattern = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?';
          i += 2;
          continue;
        }
        pattern += '.*';
        i += 1;
      } else pattern += '[^/]*';
    } else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${pattern}$`);
}

export function matchesGlob(file, glob) {
  return globToRegex(glob.replaceAll('\\', '/')).test(file.replaceAll('\\', '/'));
}

export function goldenScope(changedFiles, allowedNames) {
  const ignored = new Set(['tests/golden/update-goldens.ps1', 'tests/golden/README.md']);
  const goldenFiles = changedFiles.map(file => file.replaceAll('\\', '/'))
    .filter(file => file.startsWith('tests/golden/') && !ignored.has(file));
  const changed = goldenFiles.filter(file => file.endsWith('.txt'))
    .map(file => path.posix.basename(file, '.txt'));
  const hasManifest = goldenFiles.includes('tests/golden/manifest.ts');
  const allowed = [...new Set(allowedNames)];
  const unexpected = changed.filter(name => !allowed.includes(name));
  if (hasManifest && allowed.length === 0) unexpected.push('manifest.ts');
  return { allowed, changed, unexpected, missing: allowed.filter(name => !changed.includes(name)) };
}

export function scopeViolations(changedFiles, allowList) {
  const entries = allowList.map(item => item.replaceAll('\\', '/'));
  return changedFiles.map(file => file.replaceAll('\\', '/'))
    .filter(file => !entries.some(entry => entry === file || matchesGlob(file, entry)));
}

function capture(command, args, options = {}) {
  const viaShell = process.platform === 'win32' && ['claude', 'npx'].includes(command)
  const result = spawnSync(viaShell ? [command, ...args.map(arg => JSON.stringify(arg))].join(' ') : command, viaShell ? [] : args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    input: options.input,
    shell: viaShell,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function git(args) {
  return capture('git', args);
}

function gitText(args) {
  const result = git(args);
  return result.status === 0 ? result.stdout.trim() : null;
}

function changedFiles(mergeBase) {
  const tracked = git(['diff', '--name-only', mergeBase]);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (tracked.status !== 0 || untracked.status !== 0) {
    throw new Error(`git diff/list failed: ${tracked.stderr || untracked.stderr || 'unknown git error'}`);
  }
  return [...new Set(`${tracked.stdout}\n${untracked.stdout}`.split(/\r?\n/).filter(Boolean))].sort();
}

function resolveMergeBase(requested, explicit) {
  const candidates = explicit ? [requested] : [requested, 'origin/dev', 'HEAD~1'];
  for (const candidate of candidates) {
    const resolved = gitText(['merge-base', candidate, 'HEAD']);
    if (resolved) return { base: candidate, mergeBase: resolved };
  }
  return { base: requested, mergeBase: null };
}

function parseOptions(args) {
  const options = { base: 'dev', out: DEFAULT_OUT, json: false, skip: [], brief: null, help: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (['--brief', '--base', '--out', '--skip'].includes(arg)) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      if (arg === '--brief') options.brief = value;
      if (arg === '--base') options.base = value;
      if (arg === '--out') options.out = value;
      if (arg === '--skip') options.skip = value.split(',').map(name => name.trim()).filter(Boolean);
    } else throw new Error(`unknown option: ${arg}`);
  }
  const unknownSkips = options.skip.filter(name => !STEP_NAMES.includes(name));
  if (unknownSkips.length) throw new Error(`unknown step in --skip: ${unknownSkips.join(', ')}`);
  return options;
}

function usage() {
  return 'Usage: node scripts/check.mjs [--brief <file>] [--base <ref>] [--out <file>] [--json] [--skip <step,...>] [--help]';
}

function addStep(steps, name, action) {
  const started = Date.now();
  try {
    const result = action();
    steps.push({ name, status: result.status, ms: Date.now() - started, note: result.note ?? '', details: result.details ?? {} });
  } catch (error) {
    steps.push({ name, status: 'fail', ms: Date.now() - started, note: error.message, details: {} });
  }
}

function skipped(note) {
  return { status: 'skip', note };
}

function runCommand(command, args) {
  const result = capture(command, args);
  if (result.error) return { status: null, output: `${result.stdout}${result.stderr}`, error: result.error.message };
  return { status: result.status, output: `${result.stdout}${result.stderr}`, error: null };
}

function summarize(result, fallback) {
  if (result.error) return result.error;
  if (result.status === 0) return fallback;
  return result.output.trim().replace(/\s+/g, ' ').slice(0, 500) || `exit ${result.status}`;
}

function perform(options) {
  const startedAt = new Date().toISOString();
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const baseResult = resolveMergeBase(options.base, argsHasBase(options));
  let briefData = null;
  let briefError = null;
  if (options.brief) {
    try {
      const markdown = readFileSync(path.resolve(options.brief), 'utf8');
      briefData = parseBrief(markdown);
    } catch (error) {
      briefError = error.message;
    }
  }
  let files = [];
  let filesError = null;
  if (baseResult.mergeBase) {
    try { files = changedFiles(baseResult.mergeBase); } catch (error) { filesError = error.message; }
  } else filesError = `could not find merge-base for ${baseResult.base}`;

  const steps = [];
  const run = (name, action) => {
    if (options.skip.includes(name)) addStep(steps, name, () => skipped('skipped by --skip'));
    else addStep(steps, name, action);
  };

  run('validate', () => {
    const result = runCommand('claude', ['plugin', 'validate', '--strict', '.']);
    return { status: result.status === 0 ? 'pass' : 'fail', note: summarize(result, 'strict plugin validation passed'), details: { exitCode: result.status } };
  });
  run('test', () => {
    const result = runCommand('claude', ['plugin', 'test', '.']);
    const pass = result.output.match(/(\d+)\s+pass\b/i);
    const fail = result.output.match(/(\d+)\s+fail\b/i);
    const counts = { pass: Number(pass?.[1] ?? 0), fail: Number(fail?.[1] ?? 0) };
    const note = summarize(result, `${counts.pass} pass ${counts.fail} fail`);
    return { status: result.status === 0 ? 'pass' : 'fail', note, details: { exitCode: result.status, counts } };
  });
  run('seam', () => {
    const result = runCommand('pwsh', ['-NoProfile', '-File', 'scripts/check-seam.ps1']);
    if (result.error && /ENOENT|not found|cannot find/i.test(result.error)) return skipped('pwsh is missing');
    return { status: result.status === 0 ? 'pass' : 'fail', note: summarize(result, 'surface seam check passed'), details: { exitCode: result.status } };
  });
  run('tsc', () => {
    const hasPackage = capture('node', ['-e', "const fs=require('node:fs');process.exit(fs.existsSync('package.json')&&fs.existsSync('tsconfig.json')?0:1)"]);
    if (hasPackage.status !== 0) return skipped('no package.json/tsconfig yet (issue 50)');
    const result = runCommand('npx', ['--no-install', 'tsc', '--noEmit']);
    return { status: result.status === 0 ? 'pass' : 'fail', note: result.error ?? result.output.trim(), details: { exitCode: result.status } };
  });
  run('scripts', () => {
    const result = runCommand('node', ['--test', 'scripts/*.test.mjs']);
    const pass = result.output.match(/ℹ\s+pass\s+(\d+)/i);
    const fail = result.output.match(/ℹ\s+fail\s+(\d+)/i);
    const counts = { pass: Number(pass?.[1] ?? 0), fail: Number(fail?.[1] ?? 0) };
    return {
      status: result.status === 0 ? 'pass' : 'fail',
      note: summarize(result, `${counts.pass} pass ${counts.fail} fail`),
      details: { exitCode: result.status, counts },
    };
  });
  run('golden-scope', () => {
    if (filesError) return { status: 'fail', note: filesError };
    const goldenResult = goldenScope(files, briefData?.goldens ?? []);
    const note = goldenResult.unexpected.length
      ? `unexpected changed goldens: ${goldenResult.unexpected.join(', ')}`
      : goldenResult.missing.length ? `listed but unchanged (warning): ${goldenResult.missing.join(', ')}` : 'golden changes match the brief';
    const status = goldenResult.unexpected.length ? 'fail' : goldenResult.missing.length ? 'warn' : 'pass';
    return { status, note, details: goldenResult };
  });
  run('scope', () => {
    if (!options.brief) return skipped('pass --brief to check the allow-list');
    if (filesError) return { status: 'fail', note: filesError };
    if (briefError) return { status: 'fail', note: `could not read brief: ${briefError}` };
    const violations = scopeViolations(files, briefData?.scope ?? []);
    const checkerProblems = briefData?.problems ?? [];
    const note = violations.length
      ? `outside the brief allow-list: ${violations.join(', ')}`
      : checkerProblems.length ? `allow-list matches; brief checker flags ${checkerProblems.length} issue(s)` : 'all changed files match the brief allow-list';
    return { status: violations.length ? 'fail' : 'pass', note, details: { violations, briefProblems: checkerProblems } };
  });
  run('stamp', () => {
    if (!head || !branch) return { status: 'fail', note: 'could not read git head or branch' };
    if (filesError) return { status: 'fail', note: filesError };
    const diff = git(['diff', baseResult.mergeBase]);
    if (diff.status !== 0) return { status: 'fail', note: diff.stderr || 'git diff failed' };
    let patchId = null;
    if (diff.stdout.trim()) {
      const patch = capture('git', ['patch-id', '--stable'], { input: diff.stdout });
      if (patch.status !== 0) return { status: 'fail', note: patch.stderr || 'git patch-id failed' };
      patchId = patch.stdout.trim().split(/\s+/)[0] || null;
    }
    return { status: 'pass', note: 'working tree stamp recorded', details: { head, mergeBase: baseResult.mergeBase, branch, patchId } };
  });

  const counts = { pass: 0, fail: 0 };
  for (const step of steps) {
    const testCounts = step.details?.counts;
    if (step.name === 'test' && testCounts) {
      counts.pass = testCounts.pass;
      counts.fail = testCounts.fail;
    }
  }
  const failed = steps.filter(step => step.status === 'fail').length;
  const goldenStep = steps.find(step => step.name === 'golden-scope');
  const result = {
    ok: failed === 0,
    startedAt,
    base: baseResult.base,
    head,
    mergeBase: baseResult.mergeBase,
    branch,
    patchId: steps.find(step => step.name === 'stamp')?.details?.patchId ?? null,
    brief: options.brief,
    steps,
    counts,
    goldens: {
      allowed: goldenStep?.details?.allowed ?? [],
      changed: goldenStep?.details?.changed ?? [],
      unexpected: goldenStep?.details?.unexpected ?? [],
    },
  };
  return result;
}

// The explicit flag is tracked separately because the parsed base has a default value.
let hasExplicitBase = false;
function argsHasBase() { return hasExplicitBase; }

function runCli(args) {
  if (args.includes('--help')) {
    console.log(usage());
    return 0;
  }
  try {
    hasExplicitBase = args.includes('--base');
    const options = parseOptions(args);
    const result = perform(options);
    try {
      const outputPath = path.resolve(options.out);
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    } catch (error) {
      result.ok = false;
      result.steps.push({ name: 'output', status: 'fail', ms: 0, note: `could not write JSON: ${error.message}`, details: {} });
    }
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const step of result.steps) {
        const duration = `${(step.ms / 1000).toFixed(1)}s`;
        const label = step.status === 'pass' ? 'PASS' : step.status === 'fail' ? 'FAIL' : step.status === 'warn' ? 'WARN' : 'SKIP';
        console.log(`${label} ${step.name} ${step.note ? `: ${step.note.replace(/\s+/g, ' ')}` : ''} ${duration}`.trim());
      }
      console.log(result.ok ? 'RESULT PASS' : `RESULT FAIL (${result.steps.filter(step => step.status === 'fail').length} failed)`);
    }
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`${error.message}\n${usage()}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
