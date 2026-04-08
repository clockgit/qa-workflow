const { listTargets } = require('../config/targets');

for (const row of listTargets()) {
  console.log(row);
}
