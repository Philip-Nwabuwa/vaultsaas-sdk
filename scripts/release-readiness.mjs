import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.slice('--mode='.length) : 'full';

if (!['docs', 'package', 'full'].includes(mode)) {
  console.error(`Invalid mode "${mode}". Use docs, package, or full.`);
  process.exit(1);
}

const root = process.cwd();
const errors = [];

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function hasSemver(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    version,
  );
}

function collectExportTargets(value, targets = new Set()) {
  if (!value) {
    return targets;
  }

  if (typeof value === 'string') {
    targets.add(value);
    return targets;
  }

  if (typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      collectExportTargets(nestedValue, targets);
    }
  }

  return targets;
}

function runDocsChecks(pkg) {
  check(
    hasSemver(pkg.version),
    `package.json version "${pkg.version}" is not valid semver.`,
  );

  const changelogPath = path.join(root, 'CHANGELOG.md');
  check(existsSync(changelogPath), 'CHANGELOG.md is missing.');

  if (existsSync(changelogPath)) {
    const changelog = readFileSync(changelogPath, 'utf8');
    check(
      changelog.includes('## [Unreleased]'),
      'CHANGELOG.md must include an [Unreleased] section.',
    );
    check(
      changelog.includes(`## [${pkg.version}]`),
      `CHANGELOG.md must include a section for the current version ${pkg.version}.`,
    );
  }

  const requiredDocs = [
    'README.md',
    'SECURITY.md',
    'docs/routing.md',
    'docs/idempotency.md',
    'docs/webhooks.md',
    'docs/error-handling.md',
    'docs/platform-connector.md',
    'docs/versioning-and-migrations.md',
    'docs/troubleshooting.md',
    'docs/providers/stripe.md',
    'docs/providers/dlocal.md',
    'docs/providers/paystack.md',
  ];

  for (const relativePath of requiredDocs) {
    check(
      existsSync(path.join(root, relativePath)),
      `Required documentation file missing: ${relativePath}`,
    );
  }
}

function runPackageChecks(pkg) {
  check(
    Array.isArray(pkg.files) && pkg.files.includes('dist'),
    'package.json files must include "dist".',
  );
  check(typeof pkg.main === 'string', 'package.json main field is missing.');
  check(
    typeof pkg.module === 'string',
    'package.json module field is missing.',
  );
  check(typeof pkg.types === 'string', 'package.json types field is missing.');
  check(
    pkg.exports && typeof pkg.exports === 'object',
    'package.json exports field is missing or invalid.',
  );

  const exportTargets = collectExportTargets(pkg.exports);
  if (typeof pkg.main === 'string') {
    exportTargets.add(pkg.main);
  }
  if (typeof pkg.module === 'string') {
    exportTargets.add(pkg.module);
  }
  if (typeof pkg.types === 'string') {
    exportTargets.add(pkg.types);
  }

  for (const target of exportTargets) {
    check(
      target.startsWith('./'),
      `Export target must start with "./": ${target}`,
    );
    const normalizedTarget = target.replace(/^\.\//, '');
    const absolutePath = path.join(root, normalizedTarget);
    check(
      existsSync(absolutePath),
      `Missing built artifact referenced by package.json: ${target}`,
    );
  }
}

const pkg = readJson('package.json');

if (mode === 'docs' || mode === 'full') {
  runDocsChecks(pkg);
}

if (mode === 'package' || mode === 'full') {
  runPackageChecks(pkg);
}

if (errors.length > 0) {
  console.error('Release readiness checks failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Release readiness checks passed (${mode} mode).`);
