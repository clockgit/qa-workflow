const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { getCsvSets, getDefaultCsvSetPath, getDefaultSuite, getPathConfig, listAllSuites, listTargetsForSuite } = require('../config');
const { createPrompt } = require('../run/workflow-utils');

const ROOT_DIR = path.resolve(__dirname, '../..');
const VISUAL_DIR = path.join(ROOT_DIR, getPathConfig('visualDir', 'visual-regression'));
const RUNS_DIR = path.join(ROOT_DIR, getPathConfig('visualRunsDir', 'visual-regression/runs'));
const REPORTS_DIR = path.join(ROOT_DIR, getPathConfig('visualReportsDir', 'visual-regression/reports'));
const SUITE_NAMES = listAllSuites();
const DEFAULT_SUITE = SUITE_NAMES.includes(getDefaultSuite()) ? getDefaultSuite() : SUITE_NAMES[0];

function runNodeScript(scriptName, args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName), ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

function slugifySegment(value = '') {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase();
}

function getTimestamp() {
  return new Date().toISOString().replace(/:/g, '-').slice(0, 19);
}

function buildSnapshotName(target, suite, prefix = '') {
  const normalizedPrefix = slugifySegment(prefix);
  const baseName = `${target}-${suite}-${getTimestamp()}`;
  return normalizedPrefix ? `${normalizedPrefix}-${baseName}` : baseName;
}

function getDefaultCsvFile(suite) {
  return getDefaultCsvSetPath(suite) || path.join(getPathConfig('visualDir', 'visual-regression'), 'sample.csv');
}

function listCsvFilesForSuite(suite) {
  return Object.values(getCsvSets(suite) || {})
    .filter(Boolean)
    .sort();
}

function readManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listSnapshotsForSuite(suite) {
  if (!fs.existsSync(RUNS_DIR)) {
    return [];
  }

  return fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const snapshot = entry.name;
      const snapshotDir = path.join(RUNS_DIR, snapshot);
      const flatManifestPath = path.join(snapshotDir, 'manifest.json');

      if (!fs.existsSync(flatManifestPath)) {
        return null;
      }

      const manifest = readManifest(flatManifestPath);
      const manifestSuite = manifest.suite || '';

      if (manifestSuite !== suite) {
        return null;
      }

      return {
        snapshot,
        csvPath: manifest.csvPath || '',
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.snapshot.localeCompare(left.snapshot));
}

function formatCsvChoice(csvPath) {
  return csvPath ? path.basename(csvPath) : '(unknown csv)';
}

async function chooseCsvForSuite(prompt, suite) {
  const csvOptions = listCsvFilesForSuite(suite);

  if (!csvOptions.length) {
    return await prompt.ask('CSV path relative to the project root', getDefaultCsvFile(suite));
  }

  if (csvOptions.length === 1) {
    return csvOptions[0];
  }

  const preferredCsv = csvOptions.includes(getDefaultCsvFile(suite)) ? getDefaultCsvFile(suite) : csvOptions[0];
  const choice = await prompt.choose(
    'CSV',
    csvOptions.map(formatCsvChoice),
    formatCsvChoice(preferredCsv)
  );

  return csvOptions.find((csvPath) => formatCsvChoice(csvPath) === choice) || preferredCsv;
}

async function chooseCsvFromSnapshots(prompt, suite) {
  const snapshots = listSnapshotsForSuite(suite);
  const csvOptions = [...new Set(snapshots.map((entry) => entry.csvPath).filter(Boolean))];

  if (!csvOptions.length) {
    return '';
  }

  if (csvOptions.length === 1) {
    return csvOptions[0];
  }

  const preferredCsv = csvOptions.includes(getDefaultCsvFile(suite)) ? getDefaultCsvFile(suite) : csvOptions[0];
  const choice = await prompt.choose(
    'CSV',
    csvOptions.map(formatCsvChoice),
    formatCsvChoice(preferredCsv)
  );

  return csvOptions.find((csvPath) => formatCsvChoice(csvPath) === choice) || preferredCsv;
}

async function chooseSnapshot(prompt, label, suite, csvPath) {
  const snapshots = listSnapshotsForSuite(suite)
    .filter((entry) => entry.csvPath === csvPath)
    .map((entry) => entry.snapshot);

  if (!snapshots.length) {
    return await prompt.ask(`${label} snapshot`, '');
  }

  return await prompt.choose(`${label} snapshot`, snapshots, snapshots[0]);
}

function listReportsForSite(suite) {
  const siteReportDir = path.join(REPORTS_DIR, suite);

  if (!fs.existsSync(siteReportDir)) {
    return [];
  }

  return fs.readdirSync(siteReportDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

function deleteSnapshot(snapshot) {
  const snapshotDir = path.join(RUNS_DIR, snapshot);

  if (fs.existsSync(snapshotDir)) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}

function deleteReport(suite, reportName) {
  const reportDir = path.join(REPORTS_DIR, suite, reportName);
  const zipPath = `${reportDir}.zip`;

  if (fs.existsSync(reportDir)) {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }

  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }
}

function deleteReportsForSnapshot(suite, snapshot) {
  const siteReportDir = path.join(REPORTS_DIR, suite);

  if (!fs.existsSync(siteReportDir)) {
    return;
  }

  const reportNames = fs.readdirSync(siteReportDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.includes(snapshot));

  for (const reportName of reportNames) {
    deleteReport(suite, reportName);
  }
}

function deleteAllVisualArtifacts() {
  if (fs.existsSync(RUNS_DIR)) {
    fs.rmSync(RUNS_DIR, { recursive: true, force: true });
  }

  if (fs.existsSync(REPORTS_DIR)) {
    fs.rmSync(REPORTS_DIR, { recursive: true, force: true });
  }

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

async function main() {
  const prompt = createPrompt();

  try {
    const action = await prompt.choose(
      'Visual regression',
      ['Capture snapshot', 'Compare snapshots', 'Delete captures / reports', 'Cancel'],
      'Capture snapshot'
    );

    if (action === 'Cancel') {
      return;
    }

    if (action === 'Capture snapshot') {
      const suites = SUITE_NAMES;
      const suite = await prompt.choose('Suite', suites, suites.includes(DEFAULT_SUITE) ? DEFAULT_SUITE : suites[0]);
      const targets = listTargetsForSuite(suite);
      const target = await prompt.choose('Target', targets, targets[0]);
      const csvPath = await chooseCsvForSuite(prompt, suite);
      const prefix = await prompt.ask('Run name prefix (blank for none)', '');
      const snapshotName = buildSnapshotName(target, suite, prefix);

      prompt.close();
      process.exit(runNodeScript('index.js', ['capture', snapshotName, target, suite, csvPath]));
    }

    if (action === 'Compare snapshots') {
      const suites = SUITE_NAMES;
      const suite = await prompt.choose('Suite', suites, suites.includes(DEFAULT_SUITE) ? DEFAULT_SUITE : suites[0]);
      const csvPath = await chooseCsvFromSnapshots(prompt, suite);
      const beforeSnapshot = await chooseSnapshot(prompt, 'Before snapshot', suite, csvPath);
      const afterSnapshot = await chooseSnapshot(prompt, 'After snapshot', suite, csvPath);
      const provideZip = await prompt.choose('Provide zip?', ['no', 'yes'], 'no');
      prompt.close();
      const args = ['compare', beforeSnapshot, afterSnapshot, suite];
      if (provideZip === 'yes') {
        args.push('--zip');
      }
      process.exit(runNodeScript('index.js', args));
    }

    if (action === 'Delete captures / reports') {
      const confirm = await prompt.choose('Delete all captures and reports?', ['no', 'yes'], 'no');

      if (confirm === 'yes') {
        deleteAllVisualArtifacts();
        console.log('Deleted all visual regression captures and reports');
      }

      return;
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
