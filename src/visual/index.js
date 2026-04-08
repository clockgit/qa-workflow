const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatchModule = require('pixelmatch');
const { getPathConfig, getRegionDefinitions } = require('../config');
const { getAuthStatePath } = require('../auth/auth-state');
const { requiresLogin, resolveTarget } = require('../config/targets');

const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 2200 },
  { name: 'tablet', width: 1024, height: 1800 },
  { name: 'phone', width: 430, height: 2200 },
];

const ROOT_DIR = path.resolve(__dirname, '../..');
const VISUAL_ROOT = path.join(ROOT_DIR, getPathConfig('visualDir', 'visual-regression'));
const RUNS_DIR = path.join(ROOT_DIR, getPathConfig('visualRunsDir', 'visual-regression/runs'));
const REPORTS_DIR = path.join(ROOT_DIR, getPathConfig('visualReportsDir', 'visual-regression/reports'));
const PIXELMATCH_THRESHOLD = Number(process.env.VISUAL_PIXELMATCH_THRESHOLD || '0.1');

function classifyCloudFrontCache(xCacheHeader) {
  const value = String(xCacheHeader || '').trim();
  const normalized = value.toLowerCase();

  if (!value) {
    return '';
  }

  if (normalized.includes('hit from cloudfront') || normalized.includes('refreshhit from cloudfront')) {
    return 'HIT';
  }

  if (normalized.includes('miss from cloudfront')) {
    return 'MISS';
  }

  if (normalized.includes('error from cloudfront')) {
    return 'ERROR';
  }

  return 'OTHER';
}

async function stabilizePage(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready.catch(() => {});
    }
  });
  await page.waitForFunction(
    () => {
      if (document.readyState !== 'complete') {
        return false;
      }

      return Array.from(document.images || []).every((image) => image.complete);
    },
    { timeout: 3000 }
  ).catch(() => {});
  await page.waitForTimeout(1000);
}

function usage() {
  console.log(`Usage:
  node src/visual/index.js capture [snapshot] <target> <suite> <csvPath>
  node src/visual/index.js compare <beforeSnapshot> <afterSnapshot> <suite> [--zip]

Examples:
  npm run visual:capture -- sample-target sample-suite qa-workflow/visual-regression/sample.csv
  npm run visual:capture -- baseline-sample sample-target sample-suite qa-workflow/visual-regression/sample.csv
  npm run visual:compare -- before-sample after-sample sample-suite --zip`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(input) {
  return String(input)
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'root';
}

function humanizeKey(input) {
  return String(input || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function csvToRows(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = parseCsvLine(lines.shift()).map((header) => header.trim());

  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || '').trim();
    });
    return row;
  });
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function loadPaths(csvPath) {
  const absoluteCsvPath = path.resolve(ROOT_DIR, csvPath);
  const csvText = fs.readFileSync(absoluteCsvPath, 'utf8');
  const rows = csvToRows(csvText);

  return rows
    .filter((row) => row.path)
    .filter((row) => !row.enabled || row.enabled.toLowerCase() !== 'false')
    .map((row) => ({
      path: row.path,
      label: row.label || row.path,
      notes: row.notes || '',
    }));
}

function getRunDir(snapshot, target, suite) {
  void target;
  void suite;
  return path.join(RUNS_DIR, snapshot);
}

function getReportDir(beforeSnapshot, afterSnapshot, suite) {
  return path.join(
    REPORTS_DIR,
    suite,
    `${beforeSnapshot}-vs-${afterSnapshot}`
  );
}

function getManifestPath(baseDir) {
  return path.join(baseDir, 'manifest.json');
}

function regionFileName(pathSlug, viewportName, region) {
  return `${pathSlug}--${viewportName}--${region}.png`;
}

function getRegionsForSuite(suite) {
  return getRegionDefinitions(suite);
}

function getRegionKeysForSuite(suite) {
  return getRegionsForSuite(suite).map((region) => region.key);
}

function getRegionLabel(regionKey, regions) {
  return regions.find((region) => region.key === regionKey)?.label || regionKey;
}

function getDateStamp() {
  return new Date().toISOString().replace(/:/g, '-').slice(0, 19);
}

function getDefaultSnapshotName(target, suite) {
  return `${target}-${suite}-${getDateStamp()}`;
}

function formatWorkspacePath(targetPath) {
  const relativePath = path.relative(process.cwd(), targetPath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : targetPath;
}

function openPathInBrowser(targetPath) {
  const opener = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', targetPath]
    : [targetPath];

  const child = spawn(opener, args, {
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', () => {
    console.warn(`Could not open report automatically. Open it manually at ${formatWorkspacePath(targetPath)}`);
  });
  child.unref();
}

function createShareZip(reportDir, beforeRunDir, afterRunDir) {
  const zipPath = `${reportDir}.zip`;
  const relativeReportDir = path.relative(VISUAL_ROOT, reportDir);
  const relativeBeforeRunDir = path.relative(VISUAL_ROOT, beforeRunDir);
  const relativeAfterRunDir = path.relative(VISUAL_ROOT, afterRunDir);
  const uniqueTargets = [...new Set([relativeReportDir, relativeBeforeRunDir, relativeAfterRunDir])];
  const result = spawnSync('zip', ['-qr', zipPath, ...uniqueTargets], {
    cwd: VISUAL_ROOT,
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const errorOutput = [result.stdout?.toString(), result.stderr?.toString()]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(errorOutput || `zip failed with exit code ${result.status}`);
  }

  return zipPath;
}

async function captureSnapshot(snapshot, target, suite, csvPath) {
  const baseUrl = resolveTarget(target, suite);
  const needsLogin = requiresLogin(target, suite);
  const authStatePath = getAuthStatePath(target, suite);
  const regions = getRegionsForSuite(suite);

  if (needsLogin && !fs.existsSync(authStatePath)) {
    throw new Error(
      `Saved login state is required for ${target}/${suite}. Run: npm run auth -- ${target} ${suite}`
    );
  }

  const runDir = getRunDir(snapshot, target, suite);
  ensureDir(runDir);

  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    ignoreHTTPSErrors: true,
  };

  if (needsLogin) {
    contextOptions.storageState = authStatePath;
  }

  const paths = loadPaths(csvPath);
  const manifest = {
    snapshot,
    target,
    suite,
    baseUrl,
    csvPath,
    regions,
    createdAt: new Date().toISOString(),
    entries: [],
  };

  try {
    const viewportResults = await Promise.all(VIEWPORTS.map(async (viewport) => {
      const viewportDir = path.join(runDir, viewport.name);
      ensureDir(viewportDir);

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const entries = [];

      try {
        for (const entry of paths) {
          const entryUrl = new URL(entry.path, `${baseUrl}/`).toString();
          const pathSlug = slugify(entry.path);
          const navigationStartedAt = Date.now();
          const entryRecord = {
            path: entry.path,
            label: entry.label,
            notes: entry.notes,
            viewport: viewport.name,
            width: viewport.width,
            height: viewport.height,
            files: {},
          };

          const response = await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.locator('body').waitFor({ state: 'visible', timeout: 15000 });
          await stabilizePage(page);
          const responseHeaders = response ? response.headers() : {};
          const xCache = responseHeaders['x-cache'] || '';
          entryRecord.status = response ? response.status() : null;
          entryRecord.ok = response ? response.ok() : null;
          entryRecord.finalUrl = page.url();
          entryRecord.loadDurationMs = Date.now() - navigationStartedAt;
          entryRecord.xCache = xCache;
          entryRecord.cloudFrontCacheStatus = classifyCloudFrontCache(xCache);
          entryRecord.cloudFrontPop = responseHeaders['x-amz-cf-pop'] || '';
          entryRecord.age = responseHeaders.age || '';

          for (const region of regions) {
            const regionPath = path.join(viewportDir, regionFileName(pathSlug, viewport.name, region.key));

            if (region.mode === 'full') {
              await page.screenshot({ path: regionPath, fullPage: true }).catch(() => {});
            }
            else {
              const locator = page.locator(region.selector).first();
              const regionCount = await locator.count();

              if (!regionCount) {
                continue;
              }

              const visible = await locator.isVisible().catch(() => false);

              if (!visible) {
                continue;
              }

              await locator.screenshot({ path: regionPath }).catch(() => {});
            }

            if (fs.existsSync(regionPath)) {
              entryRecord.files[region.key] = path.relative(runDir, regionPath);
            }
          }

          entries.push(entryRecord);
        }
      }
      finally {
        await page.close();
        await context.close();
      }

      return entries;
    }));

    manifest.entries = viewportResults
      .flat()
      .sort((left, right) => left.path.localeCompare(right.path) || left.viewport.localeCompare(right.viewport));
  }
  finally {
    await browser.close();
  }

  fs.writeFileSync(getManifestPath(runDir), JSON.stringify(manifest, null, 2));
  console.log(`Saved capture manifest to ${formatWorkspacePath(getManifestPath(runDir))}`);
}

function findRunDirectory(snapshot, suite) {
  const snapshotDir = path.join(RUNS_DIR, snapshot);

  if (!fs.existsSync(snapshotDir)) {
    throw new Error(`Missing snapshot directory: ${snapshotDir}`);
  }

  const flatManifestPath = getManifestPath(snapshotDir);
  if (!fs.existsSync(flatManifestPath)) {
    throw new Error(`Missing manifest for snapshot "${snapshot}".`);
  }

  const manifest = JSON.parse(fs.readFileSync(flatManifestPath, 'utf8'));
  const manifestSuite = manifest.suite || '';

  if (manifestSuite !== suite) {
    throw new Error(`Snapshot "${snapshot}" does not match ${suite}.`);
  }

  return {
    target: manifest.target || '',
    runDir: snapshotDir,
  };
}

function loadManifest(snapshot, suite) {
  const { target, runDir } = findRunDirectory(snapshot, suite);
  const manifestPath = getManifestPath(runDir);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }

  return {
    target,
    runDir,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
  };
}

function readPng(pngPath) {
  return PNG.sync.read(fs.readFileSync(pngPath));
}

function resizePng(png, width, height) {
  const output = new PNG({ width, height });
  PNG.bitblt(png, output, 0, 0, png.width, png.height, 0, 0);
  return output;
}

function compareImages(beforePath, afterPath, diffPath) {
  const before = readPng(beforePath);
  const after = readPng(afterPath);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const beforeImage = before.width === width && before.height === height ? before : resizePng(before, width, height);
  const afterImage = after.width === width && after.height === height ? after : resizePng(after, width, height);
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    beforeImage.data,
    afterImage.data,
    diff.data,
    width,
    height,
    { threshold: PIXELMATCH_THRESHOLD }
  );
  const mismatchPercent = Number(((mismatchedPixels / (width * height)) * 100).toFixed(4));

  if (mismatchedPixels > 0) {
    ensureDir(path.dirname(diffPath));
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    width,
    height,
    mismatchedPixels,
    mismatchPercent,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeManifestRegions(regions) {
  if (!Array.isArray(regions) || !regions.length) {
    return null;
  }

  return regions.map((region) =>
    typeof region === 'string'
      ? { key: region, label: region, selector: region, mode: region === 'full' ? 'full' : 'selector' }
      : region
  );
}

function compareSnapshots(beforeSnapshot, afterSnapshot, suite, options = {}) {
  const before = loadManifest(beforeSnapshot, suite);
  const after = loadManifest(afterSnapshot, suite);
  const beforeRegions = normalizeManifestRegions(before.manifest.regions);
  const afterRegions = normalizeManifestRegions(after.manifest.regions);

  if (!beforeRegions) {
    throw new Error(
      `Snapshot "${beforeSnapshot}" is missing manifest.regions. Re-capture it with the current qa-workflow version before comparing.`
    );
  }

  if (!afterRegions) {
    throw new Error(
      `Snapshot "${afterSnapshot}" is missing manifest.regions. Re-capture it with the current qa-workflow version before comparing.`
    );
  }

  const beforeRegionKeys = beforeRegions.map((region) => region.key);
  const afterRegionKeys = afterRegions.map((region) => region.key);
  const beforeCsvPath = before.manifest.csvPath || '';
  const afterCsvPath = after.manifest.csvPath || '';

  if (beforeCsvPath !== afterCsvPath) {
    throw new Error(
      `Snapshot CSV mismatch for suite "${suite}": before uses "${beforeCsvPath}", after uses "${afterCsvPath}".`
    );
  }

  if (JSON.stringify(beforeRegionKeys) !== JSON.stringify(afterRegionKeys)) {
    throw new Error(
      `Snapshot region mismatch for suite "${suite}": before uses [${beforeRegionKeys.join(', ')}], after uses [${afterRegionKeys.join(', ')}].`
    );
  }

  const regions = beforeRegions;
  const regionKeys = regions.map((region) => region.key);

  const reportDir = getReportDir(beforeSnapshot, afterSnapshot, suite);
  const diffDir = path.join(reportDir, 'diffs');
  const beforeEntries = new Map(
    before.manifest.entries.map((entry) => [`${entry.path}::${entry.viewport}`, entry])
  );
  const rows = [];

  ensureDir(reportDir);
  ensureDir(diffDir);

  for (const afterEntry of after.manifest.entries) {
    const key = `${afterEntry.path}::${afterEntry.viewport}`;
    const beforeEntry = beforeEntries.get(key);

    if (!beforeEntry || !afterEntry) {
      rows.push({
        path: afterEntry.path,
        label: afterEntry.label,
        notes: afterEntry.notes || '',
        viewport: afterEntry.viewport,
        status: 'missing',
        mismatchPercent: 100,
        sections: Object.fromEntries(regionKeys.map((region) => [region, {
          status: 'missing',
          mismatchPercent: 100,
          before: '',
          after: '',
          diff: '',
        }])),
      });
      continue;
    }

    const row = {
      path: afterEntry.path,
      label: afterEntry.label,
      notes: afterEntry.notes || '',
      viewport: afterEntry.viewport,
      status: 'pass',
      mismatchPercent: 0,
      sections: {},
    };

    for (const region of regionKeys) {
      if (!beforeEntry.files[region] || !afterEntry.files[region]) {
        row.sections[region] = {
          status: 'missing',
          mismatchPercent: 100,
          before: beforeEntry.files[region] ? path.relative(reportDir, path.join(before.runDir, beforeEntry.files[region])) : '',
          after: afterEntry.files[region] ? path.relative(reportDir, path.join(after.runDir, afterEntry.files[region])) : '',
          diff: '',
        };
        continue;
      }

      const regionDiffPath = path.join(
        diffDir,
        regionFileName(slugify(afterEntry.path), afterEntry.viewport, region)
      );
      const regionComparison = compareImages(
        path.join(before.runDir, beforeEntry.files[region]),
        path.join(after.runDir, afterEntry.files[region]),
        regionDiffPath
      );

      row.sections[region] = {
        status: regionComparison.mismatchPercent > 0 ? 'fail' : 'pass',
        mismatchPercent: regionComparison.mismatchPercent,
        before: path.relative(reportDir, path.join(before.runDir, beforeEntry.files[region])),
        after: path.relative(reportDir, path.join(after.runDir, afterEntry.files[region])),
        diff: fs.existsSync(regionDiffPath) ? path.relative(reportDir, regionDiffPath) : '',
      };
    }

    if (Object.values(row.sections).some((section) => section.status === 'fail')) {
      row.status = 'fail';
    }
    else if (Object.values(row.sections).some((section) => section.status === 'missing')) {
      row.status = 'missing';
    }

    row.mismatchPercent = Math.max(...Object.values(row.sections).map((section) => section.mismatchPercent || 0));

    rows.push(row);
  }

  rows.sort((left, right) => left.path.localeCompare(right.path) || left.viewport.localeCompare(right.viewport));
  const shareZipPath = options.provideZip ? shareZipPathPlaceholder(reportDir) : '';
  fs.writeFileSync(path.join(reportDir, 'index.html'), buildSummaryPage(rows, {
    beforeSnapshot,
    afterSnapshot,
    beforeEnvironment: before.target,
    afterEnvironment: after.target,
    site: suite,
    regions,
    csvPath: beforeCsvPath,
    shareZipPath: path.relative(reportDir, shareZipPath),
  }));
  fs.writeFileSync(
    path.join(reportDir, 'report.json'),
    JSON.stringify({
      beforeSnapshot,
      afterSnapshot,
      beforeEnvironment: before.target,
      afterEnvironment: after.target,
      site: suite,
      csvPath: beforeCsvPath,
      shareZipPath: shareZipPath ? path.relative(reportDir, shareZipPath) : '',
      rows,
    }, null, 2)
  );
  if (options.provideZip) {
    createShareZip(reportDir, before.runDir, after.runDir);
  }
  const reportPath = path.join(reportDir, 'index.html');
  console.log(`Saved visual regression report to ${formatWorkspacePath(reportPath)}`);
  if (shareZipPath) {
    console.log(`Saved share zip to ${formatWorkspacePath(shareZipPath)}`);
  }
  openPathInBrowser(reportPath);
}

function shareZipPathPlaceholder(reportDir) {
  return `${reportDir}.zip`;
}

function buildSummaryPage(rows, metadata) {
  const regions = metadata.regions && metadata.regions.length
    ? metadata.regions
    : [{ key: 'full', label: 'Full page', selector: '', mode: 'full' }];
  const regionKeys = regions.map((region) => region.key);
  const sectionCounts = Object.fromEntries(regionKeys.map((region) => [region, {
    pass: 0,
    fail: 0,
    missing: 0,
    maxMismatch: 0,
  }]));
  const viewportCounts = Object.fromEntries(VIEWPORTS.map((viewport) => [viewport.name, {
    total: 0,
    fail: 0,
    missing: 0,
    maxMismatch: 0,
  }]));
  const counts = rows.reduce((accumulator, row) => {
    accumulator.total += 1;
    accumulator[row.status] = (accumulator[row.status] || 0) + 1;
    accumulator.maxMismatch = Math.max(accumulator.maxMismatch, row.mismatchPercent || 0);
    return accumulator;
  }, { total: 0, pass: 0, fail: 0, missing: 0, maxMismatch: 0 });

  for (const row of rows) {
    if (viewportCounts[row.viewport]) {
      viewportCounts[row.viewport].total += 1;
      viewportCounts[row.viewport][row.status] += 1;
      viewportCounts[row.viewport].maxMismatch = Math.max(viewportCounts[row.viewport].maxMismatch, row.mismatchPercent || 0);
    }

    for (const region of regionKeys) {
      const section = row.sections?.[region];

      if (!section) {
        continue;
      }

      sectionCounts[region][section.status] += 1;
      sectionCounts[region].maxMismatch = Math.max(sectionCounts[region].maxMismatch, section.mismatchPercent || 0);
    }
  }

  const verdict = counts.fail || counts.missing
    ? `${counts.fail} changed, ${counts.missing} unavailable`
    : 'No visual differences detected';
  const passPercent = counts.total ? ((counts.pass / counts.total) * 100) : 0;
  const failPercent = counts.total ? ((counts.fail / counts.total) * 100) : 0;
  const donutStyle = `background: conic-gradient(
    #1f8f55 0 ${passPercent}%,
    #c53b1b ${passPercent}% ${passPercent + failPercent}%,
    #c68a12 ${passPercent + failPercent}% 100%
  );`;
  const stackedBarStyle = `background: linear-gradient(
    90deg,
    #1f8f55 0 ${passPercent}%,
    #c53b1b ${passPercent}% ${passPercent + failPercent}%,
    #c68a12 ${passPercent + failPercent}% 100%
  );`;
  const groupedRows = new Map();

  for (const row of rows) {
    const key = `${row.path}::${row.label}`;

    if (!groupedRows.has(key)) {
      groupedRows.set(key, {
        path: row.path,
        label: row.label,
        notes: row.notes || '',
        items: [],
        worstMismatch: 0,
        statuses: new Set(),
        sectionMax: Object.fromEntries(regionKeys.map((region) => [region, 0])),
      });
    }

    const group = groupedRows.get(key);
    group.items.push(row);
    group.statuses.add(row.status);
    group.worstMismatch = Math.max(group.worstMismatch, row.mismatchPercent || 0);
    for (const region of regionKeys) {
      group.sectionMax[region] = Math.max(group.sectionMax[region], row.sections?.[region]?.mismatchPercent || 0);
    }
  }

  function buildMiniDonut(stats, label, key) {
    const total = stats.pass + stats.fail + stats.missing;
    const passSlice = total ? ((stats.pass / total) * 100) : 0;
    const failSlice = total ? ((stats.fail / total) * 100) : 0;
    const donut = `background: conic-gradient(
      #1f8f55 0 ${passSlice}%,
      #c53b1b ${passSlice}% ${passSlice + failSlice}%,
      #c68a12 ${passSlice + failSlice}% 100%
    );`;

    return `<article class="mini-donut-card">
      <div class="mini-donut" style="${donut}" role="img" aria-label="${escapeHtml(`${label}: ${stats.pass} matched, ${stats.fail} changed, ${stats.missing} unavailable`)}">
        <div class="mini-donut-center">
          <div class="mini-donut-value">${escapeHtml(total)}</div>
        </div>
      </div>
      <div class="mini-donut-copy">
        <strong>${escapeHtml(label)}</strong>
        <div class="mini-legend">
          <div class="mini-legend-item"><span class="mini-legend-label"><span class="dot pass"></span>Matched</span><span>${escapeHtml(stats.pass)}</span></div>
          <div class="mini-legend-item"><span class="mini-legend-label"><span class="dot fail"></span>Changed</span><span>${escapeHtml(stats.fail)}</span></div>
          <div class="mini-legend-item"><span class="mini-legend-label"><span class="dot missing"></span>Unavailable</span><span>${escapeHtml(stats.missing)}</span></div>
          <div class="mini-legend-item"><span class="mini-legend-label">Max mismatch</span><span>${escapeHtml(stats.maxMismatch)}%</span></div>
        </div>
      </div>
    </article>`;
  }

  const orderedGroups = [...groupedRows.values()].sort((left, right) => {
    const leftRank = left.statuses.has('fail') ? 0 : left.statuses.has('missing') ? 1 : 2;
    const rightRank = right.statuses.has('fail') ? 0 : right.statuses.has('missing') ? 1 : 2;
    return leftRank - rightRank || right.worstMismatch - left.worstMismatch || left.path.localeCompare(right.path);
  });

  const sectionVisualsHtml = regionKeys.map((region) => buildMiniDonut(sectionCounts[region], getRegionLabel(region, regions), region)).join('\n');
  const viewportVisualsHtml = VIEWPORTS.map((viewport) => {
    const stats = viewportCounts[viewport.name];
    const changedPercent = stats.total ? ((stats.fail / stats.total) * 100) : 0;
    const missingPercent = stats.total ? ((stats.missing / stats.total) * 100) : 0;
    const quietPercent = Math.max(0, 100 - changedPercent - missingPercent);
    const style = `background: linear-gradient(
      90deg,
      #1f8f55 0 ${quietPercent}%,
      #c53b1b ${quietPercent}% ${quietPercent + changedPercent}%,
      #c68a12 ${quietPercent + changedPercent}% 100%
    );`;

    return `<article class="viewport-summary-card">
      <div class="viewport-summary-head">
        <strong>${escapeHtml(viewport.name.charAt(0).toUpperCase() + viewport.name.slice(1))}</strong>
        <span>${escapeHtml(stats.total)} captures</span>
      </div>
      <div class="viewport-summary-bar" style="${style}"></div>
      <div class="viewport-summary-meta">
        <span>${escapeHtml(stats.fail)} changed</span>
        <span>${escapeHtml(stats.missing)} unavailable</span>
        <span>${escapeHtml(stats.maxMismatch)}% max</span>
      </div>
    </article>`;
  }).join('\n');

  const cardsHtml = orderedGroups.map((group, index) => {
    const groupStatus = group.statuses.has('fail') ? 'fail' : group.statuses.has('missing') ? 'missing' : 'pass';
    const statusLabel = groupStatus === 'fail' ? 'Changed' : groupStatus === 'missing' ? 'Unavailable' : 'Matched';
    const severityMax = Math.max(...regionKeys.map((region) => group.sectionMax[region] || 0), 0);
    const severityBars = regionKeys.map((region) => {
      const value = group.sectionMax[region] || 0;
      const percent = severityMax > 0 ? Math.max(8, Math.round((value / severityMax) * 100)) : 8;
      const tone = value > 0 ? 'fail' : 'pass';
      return `<div class="severity-item">
        <div class="severity-label-row">
          <span class="severity-label">${escapeHtml(getRegionLabel(region, regions))}</span>
          <span class="severity-value">${escapeHtml(value)}%</span>
        </div>
        <div class="severity-track"><span class="severity-fill ${tone}" style="width: ${percent}%"></span></div>
      </div>`;
    }).join('');
    const itemCards = group.items
      .sort((left, right) => left.viewport.localeCompare(right.viewport))
      .map((row) => {
        const metrics = regionKeys.map((region) => {
          const section = row.sections?.[region] || { mismatchPercent: 100, status: 'missing' };
          return `<span class="metric-chip ${escapeHtml(section.status)}">${escapeHtml(getRegionLabel(region, regions))} ${escapeHtml(section.mismatchPercent)}%</span>`;
        }).join('');

        const sectionCards = regionKeys.map((region) => {
          const section = row.sections?.[region] || { status: 'missing', mismatchPercent: 100, before: '', after: '', diff: '' };
          const beforeAlt = `Before ${row.path} ${row.viewport} ${region}`;
          const afterAlt = `After ${row.path} ${row.viewport} ${region}`;
          const diffAlt = `Diff ${row.path} ${row.viewport} ${region}`;

          return `<section class="region-card ${escapeHtml(section.status)}" data-region="${escapeHtml(region)}">
            <div class="region-head">
              <span class="region-name">${escapeHtml(getRegionLabel(region, regions))}</span>
              <span class="pill ${escapeHtml(section.status)}">${escapeHtml(section.status === 'fail' ? 'Changed' : section.status === 'missing' ? 'Unavailable' : 'Matched')}</span>
              <span class="mismatch">${escapeHtml(section.mismatchPercent)}% mismatch</span>
            </div>
            <div class="visual-grid">
              <button class="visual-tile" type="button" data-image="${escapeHtml(section.before || '')}" data-title="${escapeHtml(beforeAlt)}">
                <span class="tile-label">Before</span>
                ${section.before ? `<img src="${escapeHtml(section.before)}" alt="${escapeHtml(beforeAlt)}" loading="lazy">` : '<span class="no-image">Not captured</span>'}
              </button>
              <button class="visual-tile" type="button" data-image="${escapeHtml(section.after || '')}" data-title="${escapeHtml(afterAlt)}">
                <span class="tile-label">After</span>
                ${section.after ? `<img src="${escapeHtml(section.after)}" alt="${escapeHtml(afterAlt)}" loading="lazy">` : '<span class="no-image">Not captured</span>'}
              </button>
              <button class="visual-tile" type="button" data-image="${escapeHtml(section.diff || '')}" data-title="${escapeHtml(diffAlt)}">
                <span class="tile-label">Diff</span>
                ${section.diff ? `<img src="${escapeHtml(section.diff)}" alt="${escapeHtml(diffAlt)}" loading="lazy">` : '<span class="no-image">No diff generated</span>'}
              </button>
            </div>
          </section>`;
        }).join('\n');

        return `<article class="viewport-card" data-status="${escapeHtml(row.status)}" data-viewport="${escapeHtml(row.viewport)}" data-mismatch="${escapeHtml(row.mismatchPercent)}">
          <div class="viewport-head">
            <span class="viewport-name">${escapeHtml(row.viewport)}</span>
            <span class="pill ${escapeHtml(row.status)}">${escapeHtml(row.status === 'fail' ? 'Changed' : row.status === 'missing' ? 'Unavailable' : 'Matched')}</span>
            <span class="mismatch">${escapeHtml(row.mismatchPercent)}% max mismatch</span>
          </div>
          <div class="metrics-row">${metrics}</div>
          <div class="region-stack">
            ${sectionCards}
          </div>
        </article>`;
      }).join('\n');

    return `<section class="path-card ${escapeHtml(groupStatus)}" data-status="${escapeHtml(groupStatus)}" data-path="${escapeHtml(group.path)}" data-group-index="${index}">
      <div class="path-head">
        <div>
          <div class="eyebrow">Path</div>
          <h2>${escapeHtml(group.label || group.path)}</h2>
          <p class="path-text">${escapeHtml(group.path)}</p>
          ${group.notes ? `<p class="notes">${escapeHtml(group.notes)}</p>` : ''}
          <div class="severity-strip">${severityBars}</div>
        </div>
        <div class="path-meta">
          <span class="pill ${escapeHtml(groupStatus)}">${escapeHtml(statusLabel)}</span>
          <span class="worst">${escapeHtml(group.worstMismatch)}% max mismatch</span>
        </div>
      </div>
      <div class="viewport-stack">
        ${itemCards}
      </div>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Visual Comparison Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f0ea;
      --panel: #fffdf9;
      --ink: #1f2a24;
      --muted: #6a746d;
      --line: #d9d1c4;
      --ok: #1f8f55;
      --ok-bg: #e4f6eb;
      --fail: #c53b1b;
      --fail-bg: #fde9e4;
      --warn: #c68a12;
      --warn-bg: #fff1cf;
      --accent: #0e5c57;
      --shadow: 0 12px 30px rgba(31, 42, 36, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Avenir Next", "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(14, 92, 87, 0.12), transparent 24%),
        linear-gradient(180deg, #fbf9f5 0%, var(--bg) 100%);
    }
    a { color: var(--accent); }
    button { font: inherit; }
    .page { max-width: 1500px; margin: 0 auto; padding: 32px 28px 56px; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, 420px); gap: 24px; margin-bottom: 24px; }
    .hero-card, .summary-card, .path-card {
      background: rgba(255, 253, 249, 0.92);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(217, 209, 196, 0.8);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .hero-card, .summary-card, .path-card { padding: 24px; }
    .eyebrow { display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; color: var(--muted); margin-bottom: 10px; }
    h1 { font-size: clamp(34px, 4vw, 56px); line-height: 0.95; margin: 0 0 10px; letter-spacing: -0.03em; }
    h2 { margin: 0 0 6px; font-size: 28px; line-height: 1.05; letter-spacing: -0.02em; }
    p { margin: 0; line-height: 1.55; }
    .subhead { max-width: 62ch; color: var(--muted); margin-bottom: 18px; }
    .pill { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 700; }
    .pill.ok, .pill.pass { background: var(--ok-bg); color: var(--ok); }
    .pill.fail { background: var(--fail-bg); color: var(--fail); }
    .pill.missing { background: var(--warn-bg); color: var(--warn); }
    .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 22px; }
    .meta-chip { border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; background: rgba(255,255,255,0.55); }
    .meta-chip strong, .summary-tile strong { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 6px; }
    .donut-wrap { display: grid; grid-template-columns: 180px 1fr; gap: 18px; align-items: center; }
    .donut { width: 180px; height: 180px; border-radius: 50%; position: relative; ${donutStyle} box-shadow: inset 0 0 0 1px rgba(255,255,255,0.7); }
    .donut::after { content: ""; position: absolute; inset: 24px; background: var(--panel); border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(217, 209, 196, 0.65); }
    .donut-center { position: absolute; inset: 0; display: grid; place-items: center; z-index: 1; text-align: center; }
    .donut-value { font-size: 44px; font-weight: 800; letter-spacing: -0.04em; }
    .donut-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.14em; }
    .legend { display: grid; gap: 10px; }
    .legend-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px dashed var(--line); padding-bottom: 8px; }
    .legend-key { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; }
    .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
    .dot.pass { background: var(--ok); }
    .dot.fail { background: var(--fail); }
    .dot.missing { background: var(--warn); }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .summary-tile { background: rgba(255,255,255,0.6); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }
    .summary-value { font-size: 32px; font-weight: 800; letter-spacing: -0.04em; }
    .visual-summary-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 18px; margin-bottom: 24px; }
    .visual-panel { background: rgba(255,255,255,0.6); border: 1px solid var(--line); border-radius: 20px; padding: 18px; }
    .panel-title { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 12px; font-weight: 800; }
    .stacked-bar { height: 18px; border-radius: 999px; ${stackedBarStyle} box-shadow: inset 0 0 0 1px rgba(255,255,255,0.85); margin-bottom: 12px; }
    .stacked-bar-legend { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .stacked-stat { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: rgba(255,255,255,0.68); }
    .stacked-stat strong { display: block; font-size: 22px; letter-spacing: -0.03em; }
    .mini-donut-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .mini-donut-card { border: 1px solid var(--line); border-radius: 16px; padding: 14px; background: rgba(255,255,255,0.68); display: grid; gap: 12px; justify-items: center; text-align: center; }
    .mini-donut { width: 96px; height: 96px; border-radius: 50%; position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.85); }
    .mini-donut::after { content: ""; position: absolute; inset: 14px; background: var(--panel); border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(217, 209, 196, 0.65); }
    .mini-donut-center { position: absolute; inset: 0; display: grid; place-items: center; z-index: 1; }
    .mini-donut-value { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; }
    .mini-donut-copy { display: grid; gap: 4px; color: var(--muted); font-size: 13px; }
    .mini-donut-copy strong { color: var(--ink); text-transform: capitalize; font-size: 15px; }
    .mini-legend { display: grid; gap: 6px; width: 100%; margin-top: 4px; }
    .mini-legend-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--muted); }
    .mini-legend-label { display: inline-flex; align-items: center; gap: 8px; }
    .viewport-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
    .viewport-summary-card { background: rgba(255,255,255,0.6); border: 1px solid var(--line); border-radius: 18px; padding: 16px; }
    .viewport-summary-head, .viewport-summary-meta { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .viewport-summary-head { margin-bottom: 10px; }
    .viewport-summary-bar { height: 12px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.85); margin-bottom: 10px; }
    .viewport-summary-meta { color: var(--muted); font-size: 13px; }
    .toolbar { display: grid; gap: 14px; margin-bottom: 24px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255,255,255,0.55); }
    .toolbar-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .toolbar-groups { display: flex; gap: 12px; flex-wrap: wrap; align-items: start; }
    .toolbar label { display: inline-flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--muted); }
    .toolbar select, .toolbar input { min-width: 160px; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: #fff; color: var(--ink); }
    .toolbar-block { display: grid; gap: 8px; flex: 0 0 auto; }
    .toolbar-title { font-size: 13px; font-weight: 700; color: var(--muted); }
    .toggle-group { display: flex; gap: 10px; flex-wrap: wrap; }
    .toggle-button {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 14px;
      background: rgba(255,255,255,0.72);
      color: var(--muted);
      font-weight: 800;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .toggle-button:hover { transform: translateY(-1px); }
    .toggle-button[aria-pressed="true"] {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    .results { display: grid; gap: 18px; }
    .path-card.pass { border-left: 8px solid var(--ok); }
    .path-card.fail { border-left: 8px solid var(--fail); }
    .path-card.missing { border-left: 8px solid var(--warn); }
    .path-head { display: flex; justify-content: space-between; gap: 18px; align-items: start; margin-bottom: 18px; }
    .path-text, .notes, .share-link { color: var(--muted); }
    .notes { margin-top: 8px; }
    .severity-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; max-width: 640px; }
    .severity-item { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; background: rgba(255,255,255,0.7); }
    .severity-label-row { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; font-size: 12px; font-weight: 800; color: var(--muted); text-transform: capitalize; }
    .severity-track { height: 8px; border-radius: 999px; background: rgba(217, 209, 196, 0.55); overflow: hidden; }
    .severity-fill { display: block; height: 100%; border-radius: 999px; min-width: 8px; }
    .severity-fill.pass { background: rgba(31, 143, 85, 0.55); }
    .severity-fill.fail { background: linear-gradient(90deg, #f1b24b 0%, #c53b1b 100%); }
    .path-meta { display: grid; gap: 10px; justify-items: end; text-align: right; }
    .worst { font-size: 14px; font-weight: 700; color: var(--muted); }
    .viewport-stack, .region-stack { display: grid; gap: 16px; }
    .viewport-card, .region-card { border: 1px solid var(--line); border-radius: 18px; padding: 16px; background: rgba(255,255,255,0.66); }
    .viewport-head, .region-head { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; margin-bottom: 14px; }
    .viewport-name { font-size: 16px; font-weight: 800; text-transform: capitalize; }
    .region-name { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
    .mismatch { color: var(--muted); font-weight: 600; }
    .metrics-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .metric-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255,255,255,0.7); font-size: 12px; font-weight: 700; text-transform: capitalize; }
    .metric-chip.pass { color: var(--ok); }
    .metric-chip.fail { color: var(--fail); }
    .metric-chip.missing { color: var(--warn); }
    .visual-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .visual-tile { appearance: none; border: 1px solid var(--line); background: #fff; border-radius: 16px; padding: 12px; text-align: left; cursor: pointer; min-height: 240px; display: flex; flex-direction: column; gap: 10px; transition: transform 120ms ease, box-shadow 120ms ease; }
    .visual-tile:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(31, 42, 36, 0.08); }
    .tile-label { font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
    .visual-tile img { width: 100%; border-radius: 12px; border: 1px solid var(--line); background: #f8f5ef; object-fit: cover; flex: 1; min-height: 0; }
    .no-image { display: grid; place-items: center; flex: 1; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); background: #faf7f1; }
    .modal[hidden] { display: none; }
    .modal { position: fixed; inset: 0; background: rgba(13, 17, 16, 0.78); padding: 32px; display: grid; place-items: center; z-index: 1000; }
    .modal-card { max-width: min(92vw, 1400px); max-height: 92vh; background: #101513; color: white; border-radius: 22px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.35); }
    .modal-head { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,0.12); }
    .modal-head h3 { margin: 0; font-size: 18px; }
    .modal-close { appearance: none; border: 0; border-radius: 999px; width: 38px; height: 38px; background: rgba(255,255,255,0.1); color: white; cursor: pointer; font-size: 20px; }
    .modal-card img { display: block; max-width: min(92vw, 1400px); max-height: calc(92vh - 72px); width: auto; height: auto; background: white; }
    @media (max-width: 1100px) {
      .hero { grid-template-columns: 1fr; }
      .donut-wrap { grid-template-columns: 1fr; justify-items: center; }
      .visual-summary-grid { grid-template-columns: 1fr; }
      .mini-donut-grid, .viewport-summary-grid, .severity-strip { grid-template-columns: 1fr; }
      .visual-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="hero-card">
        <span class="eyebrow">Visual Comparison Report</span>
        <h1>${escapeHtml(humanizeKey(metadata.suite || 'suite'))} Comparison</h1>
        <p class="subhead">${escapeHtml(verdict)} across ${escapeHtml(counts.total)} viewport captures. This report compares target ${escapeHtml(metadata.beforeEnvironment || 'before')} to ${escapeHtml(metadata.afterEnvironment || 'after')} using the path set ${escapeHtml(path.basename(metadata.csvPath || ''))}.</p>
        <div class="hero-meta">
          <div class="meta-chip"><strong>Baseline run</strong>${escapeHtml(metadata.beforeSnapshot)}</div>
          <div class="meta-chip"><strong>Comparison run</strong>${escapeHtml(metadata.afterSnapshot)}</div>
          <div class="meta-chip"><strong>Suite</strong>${escapeHtml(humanizeKey(metadata.suite || ''))}</div>
          <div class="meta-chip"><strong>Path set</strong>${escapeHtml(metadata.csvPath || '')}</div>
          <div class="meta-chip"><strong>Targets</strong>${escapeHtml(`${metadata.beforeEnvironment || ''} -> ${metadata.afterEnvironment || ''}`)}</div>
        </div>
      </div>
      <aside class="summary-card">
        <div class="donut-wrap">
          <div class="donut" role="img" aria-label="${escapeHtml(`${counts.pass} matched, ${counts.fail} changed, ${counts.missing} unavailable`)}}">
            <div class="donut-center">
              <div class="donut-value">${escapeHtml(counts.total)}</div>
              <div class="donut-label">Captures</div>
            </div>
          </div>
          <div class="legend">
            <div class="legend-item"><span class="legend-key"><span class="dot pass"></span>Matched</span><strong>${escapeHtml(counts.pass)}</strong></div>
            <div class="legend-item"><span class="legend-key"><span class="dot fail"></span>Changed</span><strong>${escapeHtml(counts.fail)}</strong></div>
            <div class="legend-item"><span class="legend-key"><span class="dot missing"></span>Unavailable</span><strong>${escapeHtml(counts.missing)}</strong></div>
          </div>
        </div>
        ${metadata.shareZipPath ? `<p class="share-link">Download the bundled share package: <a href="${escapeHtml(metadata.shareZipPath)}">${escapeHtml(path.basename(metadata.shareZipPath))}</a></p>` : '<p class="share-link">Share package creation was skipped for this comparison.</p>'}
      </aside>
    </section>

    <section class="summary-grid">
      <article class="summary-tile"><strong>Viewport Captures</strong><div class="summary-value">${escapeHtml(counts.total)}</div></article>
      <article class="summary-tile"><strong>Changed</strong><div class="summary-value">${escapeHtml(counts.fail)}</div></article>
      <article class="summary-tile"><strong>Matched</strong><div class="summary-value">${escapeHtml(counts.pass)}</div></article>
      <article class="summary-tile"><strong>Unavailable</strong><div class="summary-value">${escapeHtml(counts.missing)}</div></article>
      ${regionKeys.map((region) => `<article class="summary-tile"><strong>${escapeHtml(getRegionLabel(region, regions))} Changes</strong><div class="summary-value">${escapeHtml(sectionCounts[region].fail)}</div></article>`).join('\n')}
      <article class="summary-tile"><strong>Max Mismatch</strong><div class="summary-value">${escapeHtml(counts.maxMismatch)}%</div></article>
    </section>

    <section class="visual-summary-grid">
      <article class="visual-panel">
        <span class="panel-title">Overall Distribution</span>
        <div class="stacked-bar" aria-hidden="true"></div>
        <div class="stacked-bar-legend">
          <div class="stacked-stat"><span class="legend-key"><span class="dot pass"></span>Matched</span><strong>${escapeHtml(counts.pass)}</strong></div>
          <div class="stacked-stat"><span class="legend-key"><span class="dot fail"></span>Changed</span><strong>${escapeHtml(counts.fail)}</strong></div>
          <div class="stacked-stat"><span class="legend-key"><span class="dot missing"></span>Unavailable</span><strong>${escapeHtml(counts.missing)}</strong></div>
        </div>
      </article>
      <article class="visual-panel">
        <span class="panel-title">Section Overview</span>
        <div class="mini-donut-grid">
          ${sectionVisualsHtml}
        </div>
      </article>
    </section>

    <section class="viewport-summary-grid">
      ${viewportVisualsHtml}
    </section>

    <section class="toolbar">
      <div class="toolbar-groups">
        <div class="toolbar-block">
          <div class="toolbar-title">Status</div>
          <div class="toggle-group" id="statusFilter" role="group" aria-label="Status filter">
            <button class="toggle-button" type="button" data-value="all" aria-pressed="false">All</button>
            <button class="toggle-button" type="button" data-value="fail" aria-pressed="true">Changed</button>
            <button class="toggle-button" type="button" data-value="pass" aria-pressed="false">Matched</button>
            <button class="toggle-button" type="button" data-value="missing" aria-pressed="false">Unavailable</button>
          </div>
        </div>
        <div class="toolbar-block">
          <div class="toolbar-title">Viewport</div>
          <div class="toggle-group" id="viewportFilter" role="group" aria-label="Viewport filter">
            <button class="toggle-button" type="button" data-value="all" aria-pressed="true">All viewports</button>
            <button class="toggle-button" type="button" data-value="desktop" aria-pressed="false">Desktop</button>
            <button class="toggle-button" type="button" data-value="tablet" aria-pressed="false">Tablet</button>
            <button class="toggle-button" type="button" data-value="phone" aria-pressed="false">Phone</button>
          </div>
        </div>
        <label>Search path
          <input id="pathFilter" type="search" placeholder="/about or homepage">
        </label>
        <label>Sort
          <select id="sortBy">
            <option value="severity">Changed first</option>
            <option value="path">Path</option>
            <option value="mismatch">Largest mismatch</option>
          </select>
        </label>
      </div>
      <div class="toolbar-row">
        <div class="toggle-group" role="group" aria-label="Visible sections">
          ${regionKeys.map((region) => `<button class="toggle-button region-toggle" type="button" data-region="${escapeHtml(region)}" aria-pressed="true">${escapeHtml(getRegionLabel(region, regions))}</button>`).join('\n')}
        </div>
      </div>
    </section>

    <section class="results" id="reportBody">
      ${cardsHtml}
    </section>
  </main>
  <div class="modal" id="imageModal" hidden>
    <div class="modal-card">
      <div class="modal-head">
        <h3 id="modalTitle">Screenshot</h3>
        <button class="modal-close" id="modalClose" type="button" aria-label="Close">×</button>
      </div>
      <img id="modalImage" alt="">
    </div>
  </div>
  <script>
    const statusFilter = document.getElementById('statusFilter');
    const viewportFilter = document.getElementById('viewportFilter');
    const pathFilter = document.getElementById('pathFilter');
    const sortBy = document.getElementById('sortBy');
    const regionToggles = Array.from(document.querySelectorAll('.region-toggle'));
    const reportBody = document.getElementById('reportBody');
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalTitle = document.getElementById('modalTitle');
    const modalClose = document.getElementById('modalClose');

    function groupRank(card) {
      if (card.dataset.status === 'fail') return 0;
      if (card.dataset.status === 'missing') return 1;
      return 2;
    }

    function getPressedValue(group) {
      return group.querySelector('[aria-pressed="true"]')?.dataset.value || 'all';
    }

    function setExclusiveToggle(group, button) {
      group.querySelectorAll('.toggle-button').forEach((item) => {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
    }

    function refreshRows() {
      const rows = Array.from(reportBody.querySelectorAll('.path-card'));
      const statusValue = getPressedValue(statusFilter);
      const viewportValue = getPressedValue(viewportFilter);
      const pathValue = pathFilter.value.trim().toLowerCase();
      const allowedRegions = new Set(
        regionToggles
          .filter((button) => button.getAttribute('aria-pressed') === 'true')
          .map((button) => button.dataset.region)
          .filter(Boolean)
      );

      rows.forEach((row) => {
        const viewportCards = Array.from(row.querySelectorAll('.viewport-card'));
        viewportCards.forEach((card) => {
          const matchesStatus = statusValue === 'all' || card.dataset.status === statusValue;
          const matchesViewport = viewportValue === 'all' || card.dataset.viewport === viewportValue;
          card.hidden = !(matchesStatus && matchesViewport);

          Array.from(card.querySelectorAll('.region-card')).forEach((regionCard) => {
            regionCard.hidden = !allowedRegions.has(regionCard.dataset.region);
          });
        });

        const matchesPath = !pathValue || row.dataset.path.toLowerCase().includes(pathValue);
        const hasVisibleViewport = viewportCards.some((card) => !card.hidden);
        row.hidden = !(matchesPath && hasVisibleViewport);
      });

      const visibleRows = rows.filter((row) => !row.hidden);
      visibleRows.sort((left, right) => {
        if (sortBy.value === 'severity') {
          return groupRank(left) - groupRank(right) ||
            Number(right.querySelector('[data-mismatch]')?.dataset.mismatch || 0) - Number(left.querySelector('[data-mismatch]')?.dataset.mismatch || 0) ||
            left.dataset.path.localeCompare(right.dataset.path);
        }
        if (sortBy.value === 'mismatch') {
          return Number(right.querySelector('[data-mismatch]')?.dataset.mismatch || 0) - Number(left.querySelector('[data-mismatch]')?.dataset.mismatch || 0) ||
            left.dataset.path.localeCompare(right.dataset.path);
        }
        return left.dataset.path.localeCompare(right.dataset.path);
      });

      visibleRows.forEach((row) => reportBody.appendChild(row));
    }

    function openModal(src, title) {
      if (!src) return;
      modalImage.src = src;
      modalImage.alt = title;
      modalTitle.textContent = title;
      modal.hidden = false;
    }

    function closeModal() {
      modal.hidden = true;
      modalImage.src = '';
      modalImage.alt = '';
    }

    statusFilter.querySelectorAll('.toggle-button').forEach((button) => {
      button.addEventListener('click', () => {
        setExclusiveToggle(statusFilter, button);
        refreshRows();
      });
    });
    viewportFilter.querySelectorAll('.toggle-button').forEach((button) => {
      button.addEventListener('click', () => {
        setExclusiveToggle(viewportFilter, button);
        refreshRows();
      });
    });
    pathFilter.addEventListener('input', refreshRows);
    sortBy.addEventListener('change', refreshRows);
    regionToggles.forEach((button) => {
      button.addEventListener('click', () => {
        const current = button.getAttribute('aria-pressed') === 'true';
        button.setAttribute('aria-pressed', current ? 'false' : 'true');
        refreshRows();
      });
    });
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
    document.querySelectorAll('.visual-tile').forEach((button) => {
      button.addEventListener('click', () => openModal(button.dataset.image, button.dataset.title));
    });
    refreshRows();
  </script>
</body>
</html>`;
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  ensureDir(VISUAL_ROOT);
  ensureDir(RUNS_DIR);
  ensureDir(REPORTS_DIR);

  if (command === 'capture') {
    let snapshot;
    let target;
    let suite;
    let csvPath;

    if (args.length === 3) {
      [target, suite, csvPath] = args;
      snapshot = getDefaultSnapshotName(target, suite);
    }
    else {
      [snapshot, target, suite, csvPath] = args;
    }

    if (!snapshot || !target || !suite || !csvPath) {
      usage();
      process.exitCode = 1;
      return;
    }
    await captureSnapshot(snapshot, target, suite, csvPath);
    return;
  }

  if (command === 'compare') {
    const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
    const provideZip = args.includes('--zip');
    const [beforeSnapshot, afterSnapshot, suite] = positionalArgs;
    if (!beforeSnapshot || !afterSnapshot || !suite) {
      usage();
      process.exitCode = 1;
      return;
    }
    compareSnapshots(beforeSnapshot, afterSnapshot, suite, { provideZip });
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
