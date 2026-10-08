import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const REQUIRED = [
  'RESTATE', 'GOAL', 'SCOPE', 'FORBIDDEN', 'GOLDENS',
  'ACCEPTANCE', 'VERIFY', 'TIMEBOX', 'REPORT',
];

export function parseBrief(markdown, { root = process.cwd() } = {}) {
  const sections = new Map();
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = heading[1].replace(/\s*\([^)]*\)\s*$/, '').trim().toUpperCase();
      if (!sections.has(current)) sections.set(current, []);
    } else if (current) {
      sections.get(current).push(line);
    }
  }

  const bodies = new Map([...sections].map(([name, lines]) => [name, lines.join('\n').trim()]));
  const problems = [];
  for (const name of REQUIRED) {
    const body = bodies.get(name) ?? '';
    if (!body.trim()) problems.push({ section: name, message: 'section is missing or empty', hint: `add a non-empty ## ${name} section` });
    if (/<[^>]+>|\b(?:TODO|TBD|FIXME)\b/i.test(body)) {
      problems.push({ section: name, message: 'unfilled placeholder found', hint: 'replace placeholders with concrete brief content' });
    }
  }

  const goldenBody = bodies.get('GOLDENS') ?? '';
  const firstGoldenLine = goldenBody.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
  let goldens = [];
  if (firstGoldenLine.toLowerCase() !== 'none') {
    goldens = firstGoldenLine.split(/[\s,]+/).filter(Boolean);
    if (!goldens.length) {
      problems.push({
        section: 'GOLDENS',
        message: 'first non-blank line must be none or golden basenames',
        hint: 'write none or a comma-separated list of golden basenames',
      });
    }
    for (const name of goldens) {
      if (!/^[A-Za-z0-9._-]+(?:\.txt)?$/.test(name)) {
        problems.push({ section: 'GOLDENS', message: `invalid golden basename ${name}`, hint: 'use a basename without a path' });
        continue;
      }
      if (!existsGolden(root, name)) {
        problems.push({ section: 'GOLDENS', message: `golden ${name} does not exist`, hint: `use a basename from tests/golden/*.txt` });
      }
    }
  }

  const scopeBody = bodies.get('SCOPE') ?? '';
  const scopeLines = scopeBody.split(/\r?\n/).filter(line => line.startsWith('- '));
  const scopePath = line => {
    const raw = line.slice(2).trim();
    const codePath = raw.match(/^`([^`]+)`/)?.[1];
    return (codePath ?? raw.replace(/\s+\([^)]*\).*$/, '')).trim();
  };
  const scope = scopeLines.map(scopePath).filter(Boolean);
  if (!scope.length) problems.push({ section: 'SCOPE', message: 'no allow-list paths or globs found', hint: 'add bullet lines beginning with - ' });
  for (const line of scopeLines) {
    const entry = scopePath(line);
    if (/^hooks\/(?:register|live|view|screens)(?:\/|\.|$)/i.test(entry) && !/\(shared\)\s*$/i.test(line)) {
      problems.push({ section: 'SCOPE', message: `${entry} is shared and must be tagged (shared)`, hint: 'add (shared) to the entry' });
    }
  }
  const verifyBody = bodies.get('VERIFY') ?? '';
  if (!verifyBody.includes('node scripts/check.mjs')) {
    problems.push({ section: 'VERIFY', message: 'gate command is not mentioned', hint: 'include node scripts/check.mjs' });
  }
  const reportBody = bodies.get('REPORT') ?? '';
  if (!/\S+\.md\b/i.test(reportBody)) {
    problems.push({ section: 'REPORT', message: 'report path ending in .md is not named', hint: 'name the report markdown path' });
  }
  return { sections: bodies, scope, goldens, problems };
}

function existsGolden(root, name) {
  const basename = name.endsWith('.txt') ? name : `${name}.txt`;
  try {
    return readFileSync(path.join(root, 'tests', 'golden', basename), 'utf8') !== undefined;
  } catch {
    return false;
  }
}

function usage() {
  return 'Usage: node scripts/check-brief.mjs <brief.md> [--json] [--help]';
}

function runCli(args) {
  if (args.includes('--help')) {
    console.log(usage());
    return 0;
  }
  const json = args.includes('--json');
  const positional = args.filter(arg => arg !== '--json');
  if (positional.length !== 1 || positional[0].startsWith('-')) {
    console.error(usage());
    return 2;
  }
  try {
    const file = path.resolve(positional[0]);
    const result = parseBrief(readFileSync(file, 'utf8'));
    if (json) console.log(JSON.stringify({ ok: result.problems.length === 0, brief: positional[0], problems: result.problems }, null, 2));
    else if (result.problems.length) {
      for (const problem of result.problems) console.log(`${problem.section}: ${problem.message} (fix: ${problem.hint})`);
    } else console.log('Brief PASS');
    return result.problems.length ? 1 : 0;
  } catch (error) {
    console.error(`Could not read brief: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
