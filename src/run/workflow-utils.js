const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const { TARGETS } = require('../config/targets');
const { listAllSuites } = require('../config');

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function ask(question, defaultValue = '') {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';

    return new Promise((resolve) => {
      rl.question(`${question}${suffix}: `, (answer) => {
        const value = answer.trim() || defaultValue;
        resolve(value);
      });
    });
  }

  async function choose(question, options, defaultValue) {
    console.log(`\n${question}`);

    options.forEach((option, index) => {
      const marker = option === defaultValue ? ' (default)' : '';
      console.log(`  ${index + 1}. ${option}${marker}`);
    });

    while (true) {
      const answer = await ask('Choose a number or value', defaultValue);
      const byIndex = Number.parseInt(answer, 10);

      if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= options.length) {
        return options[byIndex - 1];
      }

      if (options.includes(answer)) {
        return answer;
      }

      console.log(`Invalid choice "${answer}".`);
    }
  }

  return {
    ask,
    choose,
    close: () => rl.close(),
  };
}

function slugify(value = '') {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function parseCsv(value = '') {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function toTag(value = '') {
  const normalized = slugify(value);
  return normalized ? `@${normalized}` : '';
}

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildGrep(tags) {
  if (!tags.length) {
    return '';
  }

  return tags.map((tag) => `(?=.*${escapeRegex(tag)})`).join('');
}

function flattenTargetHosts() {
  const hosts = new Set();

  for (const suites of Object.values(TARGETS)) {
    for (const url of Object.values(suites)) {
      try {
        const host = new URL(url).host;

        hosts.add(host);

        if (host.startsWith('www.')) {
          hosts.add(host.replace(/^www\./, ''));
        }
        else {
          hosts.add(`www.${host}`);
        }
      }
      catch {
        // Ignore malformed URLs in configuration.
      }
    }
  }

  return [...hosts];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listRecordedFiles(recordedDir) {
  if (!fs.existsSync(recordedDir)) {
    return [];
  }

  const files = [];

  function walk(currentDir, prefix = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(currentDir, entry.name);
      const nextPrefix = prefix ? path.join(prefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        walk(nextPath, nextPrefix);
        continue;
      }

      if (entry.name.endsWith('.spec.ts')) {
        files.push(nextPrefix);
      }
    }
  }

  walk(recordedDir);

  return files.sort();
}

function inferSuiteFromFilename(fileName = '') {
  const knownSuites = new Set([...listAllSuites(), 'shared']);
  const pathParts = fileName.split(path.sep);
  const suiteFromDir = pathParts.length > 1 ? pathParts[0] : '';
  const baseName = path.basename(fileName, '.raw.spec.ts');
  const parts = baseName.split('-');
  const suiteFromName = parts[0];
  const suite = knownSuites.has(suiteFromDir) ? suiteFromDir : suiteFromName;
  const name = suite === suiteFromName ? parts.slice(1).join('-') : baseName;

  return {
    suite: knownSuites.has(suite) ? suite : '',
    name,
  };
}

function buildSpecFilename({ suites = [], name = '' }) {
  const slug = slugify(name);
  const suitePart = suites.length === 1 ? suites[0] : 'shared';

  return `${suitePart}-${slug}.spec.ts`;
}

module.exports = {
  buildGrep,
  buildSpecFilename,
  createPrompt,
  escapeRegex,
  ensureDir,
  flattenTargetHosts,
  inferSuiteFromFilename,
  listRecordedFiles,
  parseCsv,
  slugify,
  toTag,
};
