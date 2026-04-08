const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { getDefaultSuite, listAllSuites, listTargetsForSuite } = require('../config');
const { createPrompt } = require('./workflow-utils');

async function main() {
  const prompt = createPrompt();

  try {
    const suites = listAllSuites();
    const suite = await prompt.choose('Suite', suites, suites.includes(getDefaultSuite()) ? getDefaultSuite() : suites[0]);
    const targets = listTargetsForSuite(suite);
    const target = await prompt.choose('Target', targets, targets[0]);

    prompt.close();

    const scriptPath = path.join(__dirname, '..', 'auth', 'manual-login.js');
    const result = spawnSync(process.execPath, [scriptPath, target, suite], {
      stdio: 'inherit',
    });

    process.exit(result.status ?? 1);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
