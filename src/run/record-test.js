const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { getDefaultSuite, getPathConfig, listAllSuites, listTargetsForSuite } = require('../config');
const { resolveTarget } = require('../config/targets');
const { createPrompt, ensureDir, slugify } = require('./workflow-utils');

async function main() {
  const prompt = createPrompt();

  try {
    const suites = listAllSuites();
    const suite = await prompt.choose('Suite', suites, suites.includes(getDefaultSuite()) ? getDefaultSuite() : suites[0]);
    const targets = listTargetsForSuite(suite);
    const target = await prompt.choose('Target', targets, targets[0]);
    const name = await prompt.ask('Recording name', 'new-test');
    const baseURL = resolveTarget(target, suite);
    const defaultPath = new URL(baseURL).pathname || '/';
    const sitePath = await prompt.ask('Path to open', defaultPath);
    const normalizedPath = sitePath.startsWith('/') ? sitePath : `/${sitePath}`;
    const targetURL = new URL(normalizedPath, baseURL).toString();
    const fileName = `${slugify(name)}.raw.spec.ts`;
    const outputPath = path.join(process.cwd(), getPathConfig('recordedDir', 'tests/recorded'), suite, fileName);

    ensureDir(path.dirname(outputPath));

    console.log(`\nRecording to ${outputPath}`);
    console.log(`Opening ${targetURL}\n`);

    const result = spawnSync('npx', [
      'playwright',
      'codegen',
      '--target=playwright-test',
      '-o',
      outputPath,
      targetURL,
    ], {
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
