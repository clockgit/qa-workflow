const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { getPathConfig } = require('../config');

const recordedDir = path.resolve(__dirname, '../..', getPathConfig('recordedDir', 'tests/recorded'));

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function listRecordedSpecs() {
  if (!fs.existsSync(recordedDir)) {
    return [];
  }

  return fs.readdirSync(recordedDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join(recordedDir, file))
    .sort();
}

async function main() {
  const recordedSpecs = listRecordedSpecs();

  if (!recordedSpecs.length) {
    console.log(`No recorded TypeScript specs found in ${getPathConfig('recordedDir', 'tests/recorded')}/.`);
    return;
  }

  console.log('This will remove recorded spec files from:');
  console.log(`- ${getPathConfig('recordedDir', 'tests/recorded')}`);
  console.log('');
  console.log('Files to remove:');

  for (const target of recordedSpecs) {
    console.log(`- ${path.relative(process.cwd(), target)}`);
  }

  console.log('');
  const answer = await ask('Type "clean" to continue or anything else to cancel:');

  if (answer !== 'clean') {
    console.log('Canceled.');
    return;
  }

  for (const target of recordedSpecs) {
    fs.rmSync(target, { force: true });
    console.log(`Removed ${path.relative(process.cwd(), target)}`);
  }

  console.log('Recorded specs cleaned.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
