const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function writeJson(targetPath, data) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function withFixture(t, config) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-visual-report-'));
  const configPath = path.join(fixtureRoot, 'qa-workflow.config.json');
  writeJson(configPath, config);

  t.after(() => {
    delete process.env.QAW_CONFIG_PATH;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  process.env.QAW_CONFIG_PATH = configPath;
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('visual report builder renders summary values from compare rows', (t) => {
  withFixture(t, {
    paths: {
      rootDir: 'qa-workflow',
    },
    suites: {
      'sample-suite': {
        targets: {
          baseline: {
            baseUrl: 'https://baseline.example.test',
          },
        },
      },
    },
  });

  const { buildSummaryPage } = freshRequire('/Users/chris/Desktop/Files/Sites/GSA/qa-workflow/src/visual/index.js');

  const html = buildSummaryPage([
    {
      path: '/',
      label: 'Homepage',
      notes: '',
      viewport: 'desktop',
      status: 'pass',
      mismatchPercent: 0,
      sections: {
        full: {
          status: 'pass',
          mismatchPercent: 0,
          before: 'before/home.png',
          after: 'after/home.png',
          diff: '',
        },
      },
    },
    {
      path: '/about',
      label: 'About',
      notes: 'changed content',
      viewport: 'tablet',
      status: 'fail',
      mismatchPercent: 12.4,
      sections: {
        full: {
          status: 'fail',
          mismatchPercent: 12.4,
          before: 'before/about.png',
          after: 'after/about.png',
          diff: 'diffs/about.png',
        },
      },
    },
    {
      path: '/contact',
      label: 'Contact',
      notes: '',
      viewport: 'phone',
      status: 'missing',
      mismatchPercent: 100,
      sections: {
        full: {
          status: 'missing',
          mismatchPercent: 100,
          before: '',
          after: 'after/contact.png',
          diff: '',
        },
      },
    },
  ], {
    beforeSnapshot: 'before-sample',
    afterSnapshot: 'after-sample',
    beforeEnvironment: 'baseline',
    afterEnvironment: 'preview',
    suite: 'sample-suite',
    regions: [{ key: 'full', label: 'Full page', selector: '', mode: 'full' }],
    csvPath: 'qa-workflow/visual-regression/sample.csv',
    shareZipPath: '',
  });

  assert.match(html, /Visual Comparison Report/);
  assert.match(html, /Sample Suite Comparison/);
  assert.match(html, /1 changed, 1 unavailable/);
  assert.match(html, /Viewport Captures/);
  assert.match(html, />3<\/div>/);
  assert.match(html, /Changed/);
  assert.match(html, /Matched/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Full page/i);
  assert.match(html, /Share package creation was skipped for this comparison/);
});
