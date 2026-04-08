const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { getAuthStatePath } = require('./auth-state');
const { resolveTarget, requiresLogin } = require('../config/targets');
const { getDefaultSuite, getDefaultTarget } = require('../config');

async function main() {
  const suite = process.argv[3] || getDefaultSuite();
  const target = process.argv[2] || getDefaultTarget(suite);

  if (!requiresLogin(target, suite)) {
    console.log(`No login is required for ${target}/${suite}.`);
    return;
  }

  const baseURL = resolveTarget(target, suite);
  const authStatePath = getAuthStatePath(target, suite);

  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  console.log(`Opening ${baseURL}`);
  console.log('Complete the login flow in the browser, then resume from the Playwright inspector.');

  await page.goto('/');
  await page.pause();

  await context.storageState({ path: authStatePath });
  await browser.close();

  console.log(`Saved auth state to ${authStatePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
