const path = require('node:path');
const { getDefaultSuite, getDefaultTarget, getPathConfig } = require('../config');
const { getTargetKey } = require('../config/targets');

function getAuthStatePath(target = getDefaultTarget(), suite = getDefaultSuite()) {
  return path.join(process.cwd(), getPathConfig('authDir', 'auth/.auth'), `${getTargetKey(target, suite)}.json`);
}

module.exports = {
  getAuthStatePath,
};
