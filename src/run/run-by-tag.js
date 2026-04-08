const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { getDefaultSuite, listAllSuites, listTargetsForSuite } = require('../config');
const { resolveTarget, requiresLogin } = require('../config/targets');
const { getAuthStatePath } = require('../auth/auth-state');
const { buildGrep, createPrompt, parseCsv, toTag } = require('./workflow-utils');

function runManualLogin(target, suite) {
  const scriptPath = path.join(__dirname, '..', 'auth', 'manual-login.js');
  const result = spawnSync(process.execPath, [scriptPath, target, suite], {
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

async function main() {
  const prompt = createPrompt();

  try {
    const suites = listAllSuites();
    const suite = await prompt.choose('Suite', suites, suites.includes(getDefaultSuite()) ? getDefaultSuite() : suites[0]);
    const targets = listTargetsForSuite(suite);
    const target = await prompt.choose('Target', targets, targets[0]);
    const tagAnswer = await prompt.ask('Tags (comma-separated, without or with @)', `${suite},smoke`);
    const targetTags = [toTag(suite)].filter(Boolean);

    const tags = parseCsv(tagAnswer)
      .map((tag) => tag.startsWith('@') ? tag : toTag(tag))
      .filter(Boolean);
    const combinedTags = [...new Set([...targetTags, ...tags])];
    const grep = buildGrep(combinedTags);

    if (requiresLogin(target, suite)) {
      const authStatePath = getAuthStatePath(target, suite);

      if (fs.existsSync(authStatePath)) {
        const authChoice = await prompt.choose(
          `Auth state found for ${target}/${suite}`,
          ['use existing auth state', 'create fresh auth state', 'cancel run'],
          'use existing auth state'
        );

        if (authChoice === 'cancel run') {
          console.log('Canceled.');
          return;
        }

        if (authChoice === 'create fresh auth state') {
          prompt.close();
          const status = runManualLogin(target, suite);

          if (status !== 0) {
            process.exit(status);
          }
        }
      }
      else {
        const authChoice = await prompt.choose(
          `No auth state found for ${target}/${suite}`,
          ['create auth state now', 'cancel run'],
          'create auth state now'
        );

        if (authChoice === 'cancel run') {
          console.log('Canceled.');
          return;
        }

        prompt.close();
        const status = runManualLogin(target, suite);

        if (status !== 0) {
          process.exit(status);
        }
      }
    }
    const baseURL = resolveTarget(target, suite);
    const args = ['playwright', 'test'];

    if (grep) {
      args.push('--grep', grep);
    }

    console.log(`\nRunning tags ${combinedTags.join(', ')} against ${target}/${suite}`);

    const result = spawnSync('npx', args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_TARGET: target,
        PLAYWRIGHT_SUITE: suite,
        PLAYWRIGHT_BASE_URL: baseURL,
      },
      shell: process.platform === 'win32',
    });

    process.exit(result.status ?? 1);
  }
  finally {
    prompt.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
