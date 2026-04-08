#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'templates');

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function ask(question, defaultValue = '') {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';

    return new Promise((resolve) => {
      rl.question(`${question}${suffix}: `, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  async function confirm(question, defaultValue = true) {
    const defaultLabel = defaultValue ? 'yes' : 'no';

    while (true) {
      const answer = (await ask(question, defaultLabel)).toLowerCase();

      if (['y', 'yes'].includes(answer)) {
        return true;
      }

      if (['n', 'no'].includes(answer)) {
        return false;
      }

      console.log(`Invalid choice "${answer}". Use yes or no.`);
    }
  }

  return {
    ask,
    confirm,
    close: () => rl.close(),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeConfigPath(value = '') {
  return value.replace(/\\/g, '/');
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

function writeFile(targetPath, content) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, 'utf8');
}

async function maybeWriteConfig(prompt, projectRoot, rootDir, includeSampleCsv) {
  const configPath = path.join(projectRoot, 'qa-workflow.config.json');
  const shouldCreate = await prompt.confirm('Create qa-workflow.config.json?', true);

  if (!shouldCreate) {
    return { created: false, configPath };
  }

  if (fs.existsSync(configPath)) {
    const shouldOverwrite = await prompt.confirm('qa-workflow.config.json already exists. Overwrite it?', false);

    if (!shouldOverwrite) {
      return { created: false, configPath };
    }
  }

  const normalizedRootDir = normalizeConfigPath(rootDir || 'qa-workflow');
  const templatePath = path.join(TEMPLATES_DIR, 'qa-workflow.config.json');
  const sampleCsvPath = includeSampleCsv
    ? `${normalizedRootDir}/visual-regression/sample.csv`
    : '';
  const rendered = renderTemplate(templatePath, {
    ROOT_DIR: normalizedRootDir,
    SAMPLE_CSV_PATH: sampleCsvPath,
  });
  const config = JSON.parse(rendered);

  if (!includeSampleCsv) {
    delete config.suites['sample-suite'].csvSets;
  }

  writeJson(configPath, config);
  console.log(`Created ${path.relative(projectRoot, configPath) || 'qa-workflow.config.json'}`);

  return { created: true, configPath };
}

async function maybeWriteSampleCsv(prompt, projectRoot, rootDir) {
  const shouldCreate = await prompt.confirm('Create a sample visual regression CSV?', true);
  const csvPath = path.join(projectRoot, rootDir, 'visual-regression', 'sample.csv');

  if (!shouldCreate) {
    return { created: false, csvPath };
  }

  if (fs.existsSync(csvPath)) {
    const shouldOverwrite = await prompt.confirm('Sample CSV already exists. Overwrite it?', false);

    if (!shouldOverwrite) {
      return { created: false, csvPath };
    }
  }

  const templatePath = path.join(TEMPLATES_DIR, 'visual-regression', 'sample.csv');
  writeFile(csvPath, readTemplate(templatePath));
  console.log(`Created ${path.relative(projectRoot, csvPath) || csvPath}`);

  return { created: true, csvPath };
}

async function maybeWritePlaywrightConfig(prompt, projectRoot) {
  const shouldCreate = await prompt.confirm('Create playwright.config.js?', true);
  const targetPath = path.join(projectRoot, 'playwright.config.js');

  if (!shouldCreate) {
    return { created: false, targetPath };
  }

  if (fs.existsSync(targetPath)) {
    const shouldOverwrite = await prompt.confirm('playwright.config.js already exists. Overwrite it?', false);

    if (!shouldOverwrite) {
      return { created: false, targetPath };
    }
  }

  const templatePath = path.join(TEMPLATES_DIR, 'playwright.config.js');
  writeFile(targetPath, readTemplate(templatePath));
  console.log(`Created ${path.relative(projectRoot, targetPath) || 'playwright.config.js'}`);

  return { created: true, targetPath };
}

async function maybeAddScript(prompt, projectRoot) {
  const shouldAdd = await prompt.confirm('Add an npm script to package.json?', true);

  if (!shouldAdd) {
    return false;
  }

  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    console.log('Skipped script setup because package.json was not found in the current directory.');
    return false;
  }

  const scriptName = await prompt.ask('Script name', 'qaw');
  const scriptValue = 'qaw --config ./qa-workflow.config.json';
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.scripts = packageJson.scripts || {};

  if (packageJson.scripts[scriptName] && packageJson.scripts[scriptName] !== scriptValue) {
    const shouldOverwrite = await prompt.confirm(`package.json already has a "${scriptName}" script. Replace it?`, false);

    if (!shouldOverwrite) {
      return false;
    }
  }

  packageJson.scripts[scriptName] = scriptValue;
  writeJson(packageJsonPath, packageJson);
  console.log(`Updated package.json with script "${scriptName}"`);

  return true;
}

async function main() {
  const prompt = createPrompt();
  const projectRoot = process.cwd();

  try {
    console.log('\nQA Workflow init');
    const rootDir = normalizeConfigPath(await prompt.ask('Workflow files directory', 'qa-workflow'));
    const sampleCsv = await maybeWriteSampleCsv(prompt, projectRoot, rootDir);
    await maybeWriteConfig(prompt, projectRoot, rootDir, sampleCsv.created);
    await maybeWritePlaywrightConfig(prompt, projectRoot);
    await maybeAddScript(prompt, projectRoot);
  }
  finally {
    prompt.close();
  }
}

module.exports = { main };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
