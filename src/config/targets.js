const { getDefaultRequiresLogin, getDefaultSuite, getDefaultTarget, listAllSuites, listTargetsForSuite, resolveTargetBaseUrl } = require('./index');

function buildTargets() {
  const targets = {};

  for (const suite of listAllSuites()) {
    for (const target of listTargetsForSuite(suite)) {
      targets[target] = targets[target] || {};
      targets[target][suite] = resolveTargetBaseUrl(suite, target);
    }
  }

  return targets;
}

const TARGETS = buildTargets();

function requiresLogin(target = getDefaultTarget(), suite = getDefaultSuite()) {
  void target;
  return getDefaultRequiresLogin(suite);
}

function getTargetKey(target = getDefaultTarget(), suite = getDefaultSuite()) {
  return `${target}-${suite}`;
}

function getTargetId(suite = getDefaultSuite()) {
  return suite;
}

function resolveTarget(target = getDefaultTarget(), suite = getDefaultSuite()) {
  const url = resolveTargetBaseUrl(suite, target);

  if (!url) {
    if (!listTargetsForSuite(suite).length) {
      throw new Error(`Unknown suite "${suite}"`);
    }

    throw new Error(`Unknown target "${target}"`);
  }

  return url;
}

function listSuitesForTarget(target = '') {
  if (!target) {
    return [];
  }

  const targetSuites = TARGETS[target];

  if (!targetSuites) {
    return [];
  }

  return Object.keys(targetSuites);
}

function listTargets() {
  const rows = [];

  for (const [target, suites] of Object.entries(TARGETS)) {
    for (const [suite, url] of Object.entries(suites)) {
      rows.push(`${target} ${suite} -> ${url}`);
    }
  }

  return rows;
}

module.exports = {
  TARGETS,
  getTargetId,
  getTargetKey,
  listSuitesForTarget,
  requiresLogin,
  resolveTarget,
  listTargets,
};
