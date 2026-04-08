const fs = require('node:fs');
const { currentTargetFromEnv, isAuthRequiredForCurrentTarget } = require('./targeting');
const { getAuthStatePath } = require('./auth-state');

function ensureAuthStateForCurrentTarget(testTargets = {}) {
  const { target, suite } = currentTargetFromEnv();

  if (!isAuthRequiredForCurrentTarget(testTargets)) {
    return;
  }

  const authStatePath = getAuthStatePath(target, suite);

  if (!fs.existsSync(authStatePath)) {
    throw new Error(
      `Missing saved login state for ${target}/${suite}. Run: npm run auth -- ${target} ${suite}`
    );
  }
}

module.exports = {
  ensureAuthStateForCurrentTarget,
};
