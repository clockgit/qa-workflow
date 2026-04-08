#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'templates');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(targetPath, data) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readTemplate(templatePath) {
  return fs.readFileSync(templatePath, 'utf8');
}

function renderTemplate(templatePath, replacements = {}) {
  let output = readTemplate(templatePath);

  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`__${key}__`, value);
  }

  return output;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(output || `${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

function createSmokeFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-smoke-'));
  const rootDir = 'qa-workflow';
  const configPath = path.join(fixtureRoot, 'qa-workflow.config.json');
  const csvPath = path.join(fixtureRoot, rootDir, 'visual-regression', 'sample.csv');

  ensureDir(path.dirname(csvPath));
  fs.writeFileSync(
    csvPath,
    readTemplate(path.join(TEMPLATES_DIR, 'visual-regression', 'sample.csv')),
    'utf8'
  );

  const renderedConfig = renderTemplate(
    path.join(TEMPLATES_DIR, 'qa-workflow.config.json'),
    {
      ROOT_DIR: rootDir,
      SAMPLE_CSV_PATH: `${rootDir}/visual-regression/sample.csv`,
    }
  );

  writeJson(configPath, JSON.parse(renderedConfig));

  return {
    fixtureRoot,
    configPath,
  };
}

function main() {
  const { fixtureRoot, configPath } = createSmokeFixture();
  const configRelativePath = path.relative(fixtureRoot, configPath) || 'qa-workflow.config.json';

  run(process.execPath, [path.join(PACKAGE_ROOT, 'bin', 'qaw'), 'validate', '--config', configRelativePath], {
    cwd: fixtureRoot,
  });

  const targetsResult = run(process.execPath, [path.join(PACKAGE_ROOT, 'src', 'run', 'list-targets.js')], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      QAW_CONFIG_PATH: configPath,
    },
  });

  const targetsOutput = targetsResult.stdout.trim();

  if (!targetsOutput.includes('sample sample-suite -> https://github.com/clockgit')) {
    throw new Error(`Unexpected target listing output:\n${targetsOutput}`);
  }

  console.log('Smoke validation passed.');
  console.log(`Validated config fixture: ${configRelativePath}`);
  console.log(`Target listing: ${targetsOutput}`);
}

module.exports = { main };

if (require.main === module) {
  try {
    main();
  }
  catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
