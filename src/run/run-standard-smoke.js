const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { getDefaultSuite, getDefaultTarget, listAllSuites } = require('../config');
const { requiresLogin, resolveTarget } = require('../config/targets');
const { getAuthStatePath } = require('../auth/auth-state');
const fs = require('node:fs');

const defaultSuite = getDefaultSuite() || listAllSuites()[0];
const target = process.argv[2] || getDefaultTarget(defaultSuite);
const mode = process.argv[3] || 'headed';

const smokeTargets = listAllSuites().map((suite) => [suite]);

for (const [suite] of smokeTargets) {
  const baseURL = resolveTarget(target, suite);
  const authNeeded = requiresLogin(target, suite);
  const authStatePath = getAuthStatePath(target, suite);

  console.log(`\n=== ${target}/${suite} ===`);
  console.log(`Base URL: ${baseURL}`);

  if (authNeeded && !fs.existsSync(authStatePath)) {
    console.log(`Skipping: missing saved login state. Run: npm run auth -- ${target} ${suite}`);
    continue;
  }

  const args = [path.join(__dirname, 'run-target.js'), mode, target, suite];
  const result = spawnSync('node', args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
