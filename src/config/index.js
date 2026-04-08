const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_FILE = 'qa-workflow.config.json';

let cachedConfig;
let cachedConfigPath;

function resolveConfigPath() {
  const envPath = process.env.QAW_CONFIG_PATH;

  if (envPath) {
    return path.isAbsolute(envPath)
      ? envPath
      : path.resolve(process.cwd(), envPath);
  }

  return path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
}

function loadConfig() {
  if (!cachedConfig) {
    cachedConfigPath = resolveConfigPath();

    if (!fs.existsSync(cachedConfigPath)) {
      throw new Error(
        `QA Workflow config not found at ${cachedConfigPath}. ` +
        `Create ${DEFAULT_CONFIG_FILE} in the consuming project root or set QAW_CONFIG_PATH.`
      );
    }

    cachedConfig = JSON.parse(fs.readFileSync(cachedConfigPath, 'utf8'));
  }

  return cachedConfig;
}

function getConfig() {
  return loadConfig();
}

function getProjectRoot() {
  return path.dirname(resolveConfigPath());
}

function firstKey(object = {}) {
  return Object.keys(object)[0] || '';
}

function getDefaultSuite() {
  return firstKey(getConfig().suites || {});
}

function getPaths() {
  return getConfig().paths || {};
}

function buildDefaultPaths(rootDir = '.') {
  const testsDir = path.join(rootDir, 'tests');
  const visualDir = path.join(rootDir, 'visual-regression');

  return {
    rootDir,
    testsDir,
    recordedDir: path.join(testsDir, 'recorded'),
    specsDir: path.join(testsDir, 'specs'),
    supportDir: path.join(testsDir, 'support'),
    authDir: path.join(rootDir, 'auth', '.auth'),
    visualDir,
    visualRunsDir: path.join(visualDir, 'runs'),
    visualReportsDir: path.join(visualDir, 'reports'),
  };
}

function getPathConfig(name, fallback = '') {
  const configuredPaths = getPaths();
  const defaultPaths = buildDefaultPaths(configuredPaths.rootDir || '.');
  return configuredPaths[name] || defaultPaths[name] || fallback;
}

function listAllSuites() {
  return Object.keys(getConfig().suites || {});
}

function listAllTargets() {
  return [...new Set(
    listAllSuites().flatMap((suite) => listTargetsForSuite(suite))
  )];
}

function getSuiteConfig(suite = '') {
  return getConfig().suites?.[suite] || {};
}

function listTargetsForSuite(suite = '') {
  return Object.keys(getSuiteConfig(suite).targets || {});
}

function getDefaultTarget(suite = getDefaultSuite()) {
  return firstKey(getSuiteConfig(suite).targets || {});
}

function getTargetConfig(suite = '', target = '') {
  return getSuiteConfig(suite).targets?.[target] || {};
}

function resolveTargetBaseUrl(suite = '', target = '') {
  return getTargetConfig(suite, target).baseUrl || '';
}

function getCsvSets(suite = '') {
  return getSuiteConfig(suite).csvSets || {};
}

function getDefaultCsvSetPath(suite = getDefaultSuite()) {
  return Object.values(getCsvSets(suite))[0] || '';
}

function getSelectors(suite = '') {
  return getSuiteConfig(suite).selectors || {};
}

function isFullRegionEnabled(suite = '') {
  const suiteConfig = getSuiteConfig(suite);

  if (typeof suiteConfig.full === 'boolean') {
    return suiteConfig.full;
  }

  return true;
}

function getRegionDefinitions(suite = '') {
  const selectors = getSelectors(suite);
  const regions = [];

  if (isFullRegionEnabled(suite)) {
    regions.push({
      key: 'full',
      label: 'Full page',
      selector: '',
      mode: 'full',
    });
  }

  regions.push(...Object.entries(selectors)
    .filter(([, selector]) => typeof selector === 'string' && selector.trim())
    .map(([key, selector]) => ({
      key,
      label: key,
      selector: selector.trim(),
      mode: 'selector',
    })));

  return regions.length ? regions : [{
    key: 'full',
    label: 'Full page',
    selector: '',
    mode: 'full',
  }];
}

function getDefaultRequiresLogin(suite = '') {
  const suiteConfig = getSuiteConfig(suite);

  return Boolean(suiteConfig.defaultRequiresLogin);
}

function getSuitePersonas(suite = '') {
  return getSuiteConfig(suite).personas || {};
}

function getPersonaSupport(suite = '') {
  return getSuiteConfig(suite).personaSupport || {};
}

function suiteSupportsPersonas(suite = '') {
  const personas = getSuitePersonas(suite);
  const support = getPersonaSupport(suite);

  return Boolean(Object.keys(personas).length && support.module);
}

module.exports = {
  CONFIG_PATH: cachedConfigPath || resolveConfigPath(),
  getConfig,
  getCsvSets,
  getDefaultCsvSetPath,
  getDefaultRequiresLogin,
  getDefaultSuite,
  getDefaultTarget,
  getPersonaSupport,
  getPathConfig,
  getPaths,
  getProjectRoot,
  getRegionDefinitions,
  isFullRegionEnabled,
  getSelectors,
  getSuiteConfig,
  getSuitePersonas,
  getTargetConfig,
  listAllSuites,
  listAllTargets,
  listTargetsForSuite,
  resolveTargetBaseUrl,
  suiteSupportsPersonas,
};
