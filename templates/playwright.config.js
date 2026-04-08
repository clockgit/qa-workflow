const fs = require('node:fs');
const { defineConfig } = require('@playwright/test');
const { config, targets } = require('@lockweb/qa-workflow');
const { getAuthStatePath } = require('@lockweb/qa-workflow/auth/auth-state');

const suite = process.env.PLAYWRIGHT_SUITE || config.getDefaultSuite();
const target = process.env.PLAYWRIGHT_TARGET || config.getDefaultTarget(suite);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || targets.resolveTarget(target, suite);
const authStatePath = getAuthStatePath(target, suite);
const storageState = fs.existsSync(authStatePath) ? authStatePath : undefined;

module.exports = defineConfig({
  testDir: `./${config.getPathConfig('testsDir', 'tests')}`,
  testIgnore: ['**/recorded/**'],
  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    storageState,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list']],
});
