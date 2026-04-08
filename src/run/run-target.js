const { spawnSync } = require('node:child_process');
const { getDefaultSuite, getDefaultTarget } = require('../config');
const { resolveTarget } = require('../config/targets');

const [, , mode = 'test', argTarget, argSuite, ...extraArgs] = process.argv;
const suite = argSuite || getDefaultSuite();
const target = argTarget || getDefaultTarget(suite);

const commands = {
  test: ['playwright', 'test'],
  ui: ['playwright', 'test', '--ui'],
  headed: ['playwright', 'test', '--headed'],
  codegen: ['playwright', 'codegen'],
};

const selected = commands[mode];

if (!selected) {
  console.error(`Unknown mode "${mode}". Use: test, ui, headed, or codegen.`);
  process.exit(1);
}

let baseURL;

try {
  baseURL = resolveTarget(target, suite);
}
catch (error) {
  console.error(error.message);
  process.exit(1);
}

const env = {
  ...process.env,
  PLAYWRIGHT_TARGET: target,
  PLAYWRIGHT_SUITE: suite,
  PLAYWRIGHT_BASE_URL: baseURL,
};

console.log(`Running ${mode} against ${target}/${suite}`);
console.log(`Base URL: ${baseURL}`);

const result = spawnSync('npx', [...selected, ...extraArgs], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
