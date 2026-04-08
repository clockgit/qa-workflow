#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '../..');
const projectRoot = process.cwd();

function parseCliArgs(argv) {
  const args = [...argv];
  let configPath = '';
  const positional = [];

  while (args.length) {
    const value = args.shift();

    if (value === '--config') {
      configPath = args.shift() || '';
      continue;
    }

    positional.push(value);
  }

  if (configPath) {
    process.env.QAW_CONFIG_PATH = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);
  }

  return positional;
}

function isInstalled() {
  const requiredPaths = [
    path.join(projectRoot, 'node_modules'),
    path.join(projectRoot, 'node_modules', '@playwright', 'test'),
    path.join(projectRoot, 'node_modules', 'playwright'),
  ];

  return requiredPaths.every((target) => fs.existsSync(target));
}

function runNodeEntry(relativeScriptPath, args = []) {
  const result = spawnSync(process.execPath, [path.join(packageRoot, relativeScriptPath), ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

async function main() {
  const { createPrompt } = require('../run/workflow-utils');
  const prompt = createPrompt();

  try {
    const installed = isInstalled();
    const options = installed
      ? [
          'Record test',
          'Publish recording',
          'Clean recorded specs',
          'Run tests',
          'Visual regression',
          'List targets',
          'Repair / Update Playwright workspace',
          'Reset Playwright workspace',
          'Exit',
        ]
      : [
          'Install Playwright workspace',
          'Exit',
        ];

    const choice = await prompt.choose('Playwright menu', options, options[0]);

    if (choice === 'Exit') {
      return;
    }

    prompt.close();

    if (choice === 'Install Playwright workspace') {
      process.exit(runNodeEntry('src/cli/setup-workspace.js'));
    }

    if (choice === 'Record test') {
      process.exit(runNodeEntry('src/run/record-test.js'));
    }

    if (choice === 'Publish recording') {
      process.exit(runNodeEntry('src/run/publish-recording.js'));
    }

    if (choice === 'Clean recorded specs') {
      process.exit(runNodeEntry('src/run/clean-recordings.js'));
    }

    if (choice === 'Run tests') {
      process.exit(runNodeEntry('src/run/run-tests.js'));
    }

    if (choice === 'Visual regression') {
      process.exit(runNodeEntry('src/visual/menu.js'));
    }

    if (choice === 'List targets') {
      process.exit(runNodeEntry('src/run/list-targets.js'));
    }

    if (choice === 'Repair / Update Playwright workspace') {
      process.exit(runNodeEntry('src/cli/setup-workspace.js'));
    }

    if (choice === 'Reset Playwright workspace') {
      process.exit(runNodeEntry('src/cli/reset-workspace.js'));
    }
  }
  finally {
    try {
      prompt.close();
    }
    catch {
      // Ignore repeated close calls.
    }
  }
}

const args = parseCliArgs(process.argv.slice(2));
const command = args[0] || 'menu';

if (command === 'init') {
  require('./init').main(args.slice(1)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
else if (command === 'menu') {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
else if (command === 'validate') {
  require('./validate').main(args.slice(1)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
else {
  console.error(`Unknown qaw command "${command}". Supported commands: menu, init, validate`);
  process.exit(1);
}
