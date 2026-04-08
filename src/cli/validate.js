#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_FILE = 'qa-workflow.config.json';

function resolveConfigPath() {
  const envPath = process.env.QAW_CONFIG_PATH;

  if (envPath) {
    return path.isAbsolute(envPath)
      ? envPath
      : path.resolve(process.cwd(), envPath);
  }

  return path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushError(errors, message) {
  errors.push(message);
}

function pushWarning(warnings, message) {
  warnings.push(message);
}

function validateStringField(value, label, errors, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    pushError(errors, `${label} must be a string.`);
    return false;
  }

  if (!allowEmpty && !value.trim()) {
    pushError(errors, `${label} must not be empty.`);
    return false;
  }

  return true;
}

function validateUrl(value, label, errors) {
  if (!validateStringField(value, label, errors)) {
    return;
  }

  try {
    new URL(value);
  }
  catch {
    pushError(errors, `${label} must be a valid URL.`);
  }
}

function validatePaths(config, projectRoot, errors, warnings) {
  const pathsConfig = config.paths || {};

  if (!isPlainObject(pathsConfig)) {
    pushError(errors, 'paths must be an object when provided.');
    return;
  }

  for (const [key, value] of Object.entries(pathsConfig)) {
    validateStringField(value, `paths.${key}`, errors);
  }

  const rootDir = pathsConfig.rootDir;

  if (typeof rootDir === 'string' && rootDir.trim()) {
    const absoluteRootDir = path.resolve(projectRoot, rootDir);

    if (!fs.existsSync(absoluteRootDir)) {
      pushWarning(warnings, `paths.rootDir does not exist yet: ${rootDir}`);
    }
  }
}

function validatePersonaSupport(suiteName, suiteConfig, projectRoot, errors) {
  const personas = suiteConfig.personas || {};
  const personaSupport = suiteConfig.personaSupport || {};

  if (suiteConfig.personas !== undefined && !isPlainObject(personas)) {
    pushError(errors, `suites.${suiteName}.personas must be an object when provided.`);
    return;
  }

  if (suiteConfig.personaSupport !== undefined && !isPlainObject(personaSupport)) {
    pushError(errors, `suites.${suiteName}.personaSupport must be an object when provided.`);
    return;
  }

  const hasPersonas = Object.keys(personas).length > 0;
  const modulePath = personaSupport.module;

  if (hasPersonas) {
    if (!validateStringField(modulePath, `suites.${suiteName}.personaSupport.module`, errors)) {
      return;
    }

    const absoluteModulePath = path.resolve(projectRoot, modulePath);

    if (!fs.existsSync(absoluteModulePath)) {
      pushError(errors, `Persona support module not found for suite "${suiteName}": ${modulePath}`);
    }
  }
  else if (modulePath !== undefined) {
    if (!validateStringField(modulePath, `suites.${suiteName}.personaSupport.module`, errors)) {
      return;
    }

    const absoluteModulePath = path.resolve(projectRoot, modulePath);

    if (!fs.existsSync(absoluteModulePath)) {
      pushError(errors, `Persona support module not found for suite "${suiteName}": ${modulePath}`);
    }
  }
}

function validateSelectors(suiteName, suiteConfig, errors) {
  const selectors = suiteConfig.selectors;

  if (selectors === undefined) {
    return;
  }

  if (!isPlainObject(selectors)) {
    pushError(errors, `suites.${suiteName}.selectors must be an object when provided.`);
    return;
  }

  for (const [key, value] of Object.entries(selectors)) {
    validateStringField(value, `suites.${suiteName}.selectors.${key}`, errors);
  }
}

function validateCsvSets(suiteName, suiteConfig, projectRoot, errors) {
  const csvSets = suiteConfig.csvSets;

  if (csvSets === undefined) {
    return;
  }

  if (!isPlainObject(csvSets) || !Object.keys(csvSets).length) {
    pushError(errors, `suites.${suiteName}.csvSets must be a non-empty object when provided.`);
    return;
  }

  for (const [key, csvPath] of Object.entries(csvSets)) {
    if (!validateStringField(csvPath, `suites.${suiteName}.csvSets.${key}`, errors)) {
      continue;
    }

    const absoluteCsvPath = path.resolve(projectRoot, csvPath);

    if (!fs.existsSync(absoluteCsvPath)) {
      pushError(errors, `CSV set file not found for suite "${suiteName}" (${key}): ${csvPath}`);
    }
  }
}

function validateTargets(suiteName, suiteConfig, errors) {
  const targets = suiteConfig.targets;

  if (!isPlainObject(targets) || !Object.keys(targets).length) {
    pushError(errors, `suites.${suiteName}.targets must be a non-empty object.`);
    return;
  }

  for (const [targetName, targetConfig] of Object.entries(targets)) {
    if (!isPlainObject(targetConfig)) {
      pushError(errors, `suites.${suiteName}.targets.${targetName} must be an object.`);
      continue;
    }

    validateUrl(
      targetConfig.baseUrl,
      `suites.${suiteName}.targets.${targetName}.baseUrl`,
      errors
    );
  }
}

function validateSuite(suiteName, suiteConfig, projectRoot, errors) {
  if (!isPlainObject(suiteConfig)) {
    pushError(errors, `suites.${suiteName} must be an object.`);
    return;
  }

  if (suiteConfig.defaultRequiresLogin !== undefined && typeof suiteConfig.defaultRequiresLogin !== 'boolean') {
    pushError(errors, `suites.${suiteName}.defaultRequiresLogin must be a boolean when provided.`);
  }

  if (suiteConfig.full !== undefined && typeof suiteConfig.full !== 'boolean') {
    pushError(errors, `suites.${suiteName}.full must be a boolean when provided.`);
  }

  validateTargets(suiteName, suiteConfig, errors);
  validateCsvSets(suiteName, suiteConfig, projectRoot, errors);
  validateSelectors(suiteName, suiteConfig, errors);
  validatePersonaSupport(suiteName, suiteConfig, projectRoot, errors);
}

function validateConfigShape(config, configPath) {
  const errors = [];
  const warnings = [];
  const projectRoot = path.dirname(configPath);

  if (!isPlainObject(config)) {
    pushError(errors, 'Config must be a JSON object.');
    return { errors, warnings };
  }

  validatePaths(config, projectRoot, errors, warnings);

  const suites = config.suites;

  if (!isPlainObject(suites) || !Object.keys(suites).length) {
    pushError(errors, 'suites must be a non-empty object.');
    return { errors, warnings };
  }

  for (const [suiteName, suiteConfig] of Object.entries(suites)) {
    validateSuite(suiteName, suiteConfig, projectRoot, errors);
  }

  return { errors, warnings };
}

function loadRawConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const contents = fs.readFileSync(configPath, 'utf8');

  try {
    return JSON.parse(contents);
  }
  catch (error) {
    throw new Error(`Config file is not valid JSON: ${configPath}\n${error.message}`);
  }
}

async function main() {
  const configPath = resolveConfigPath();
  const config = loadRawConfig(configPath);
  const { errors, warnings } = validateConfigShape(config, configPath);
  const displayPath = path.relative(process.cwd(), configPath) || configPath;

  if (warnings.length) {
    console.log(`Warnings for ${displayPath}:`);
    warnings.forEach((warning) => console.log(`- ${warning}`));
    console.log('');
  }

  if (errors.length) {
    console.error(`Config validation failed for ${displayPath}:`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log(`Config is valid: ${displayPath}`);
}

module.exports = {
  main,
  validateConfigShape,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
