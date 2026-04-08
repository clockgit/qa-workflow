const { getDefaultSuite, getDefaultTarget } = require('../config');
const { getTargetId, requiresLogin } = require('../config/targets');

function currentTargetFromEnv() {
  const suite = process.env.PLAYWRIGHT_SUITE || getDefaultSuite();
  const target = process.env.PLAYWRIGHT_TARGET || getDefaultTarget(suite);

  return {
    target,
    suite,
  };
}

function isTargetSupported(testTargets = {}) {
  const { suite } = currentTargetFromEnv();
  const supportedSuites = testTargets.suites || [];

  if (supportedSuites.length && !supportedSuites.includes(suite)) {
    return false;
  }

  return true;
}

function isAuthRequiredForCurrentTarget(testTargets = {}) {
  const { target, suite } = currentTargetFromEnv();
  const targetId = getTargetId(suite);

  if (typeof testTargets.requiresLogin === 'boolean') {
    return testTargets.requiresLogin;
  }

  if (testTargets.authByTarget && Object.prototype.hasOwnProperty.call(testTargets.authByTarget, targetId)) {
    return Boolean(testTargets.authByTarget[targetId]);
  }

  if (testTargets.authBySuite && Object.prototype.hasOwnProperty.call(testTargets.authBySuite, suite)) {
    return Boolean(testTargets.authBySuite[suite]);
  }

  return requiresLogin(target, suite);
}

module.exports = {
  currentTargetFromEnv,
  isAuthRequiredForCurrentTarget,
  isTargetSupported,
};
