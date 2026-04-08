const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function writeJson(targetPath, data) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function withFixture(t, config) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-visual-menu-'));
  const configPath = path.join(fixtureRoot, 'qa-workflow.config.json');
  writeJson(configPath, config);

  t.after(() => {
    delete process.env.QAW_CONFIG_PATH;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  process.env.QAW_CONFIG_PATH = configPath;
  return fixtureRoot;
}

test('visual menu discovers snapshots by suite and filters compare choices by csv path', (t) => {
  const fixtureRoot = withFixture(t, {
    paths: {
      rootDir: 'qa-workflow',
    },
    suites: {
      'sample-suite': {
        targets: {
          sample: {
            baseUrl: 'https://example.test',
          },
        },
        csvSets: {
          alpha: 'qa-workflow/visual-regression/alpha.csv',
          beta: 'qa-workflow/visual-regression/beta.csv',
        },
      },
      other: {
        targets: {
          sample: {
            baseUrl: 'https://other.test',
          },
        },
      },
    },
  });

  const runsDir = path.join(fixtureRoot, 'qa-workflow', 'visual-regression', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  const manifests = {
    '2026-04-08T10-00-00': { suite: 'sample-suite', target: 'sample', csvPath: 'qa-workflow/visual-regression/alpha.csv' },
    '2026-04-08T11-00-00': { suite: 'sample-suite', target: 'sample', csvPath: 'qa-workflow/visual-regression/beta.csv' },
    '2026-04-08T12-00-00': { suite: 'sample-suite', target: 'sample', csvPath: 'qa-workflow/visual-regression/alpha.csv' },
    '2026-04-08T13-00-00': { suite: 'other', target: 'sample', csvPath: 'qa-workflow/visual-regression/alpha.csv' },
  };

  for (const [snapshot, manifest] of Object.entries(manifests)) {
    const runDir = path.join(runsDir, snapshot);
    fs.mkdirSync(runDir, { recursive: true });
    writeJson(path.join(runDir, 'manifest.json'), manifest);
  }

  const visualMenu = freshRequire('/Users/chris/Desktop/Files/Sites/GSA/qa-workflow/src/visual/menu.js');

  const discovered = visualMenu.listSnapshotsForSuite('sample-suite');
  assert.deepEqual(
    discovered.map((entry) => entry.snapshot),
    ['2026-04-08T12-00-00', '2026-04-08T11-00-00', '2026-04-08T10-00-00']
  );

  assert.deepEqual(
    visualMenu.listSnapshotChoicesForSuite('sample-suite', 'qa-workflow/visual-regression/alpha.csv'),
    ['2026-04-08T12-00-00', '2026-04-08T10-00-00']
  );

  assert.deepEqual(
    visualMenu.listSnapshotChoicesForSuite('sample-suite', 'qa-workflow/visual-regression/beta.csv'),
    ['2026-04-08T11-00-00']
  );
});
