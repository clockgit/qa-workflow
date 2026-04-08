const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const rootDir = path.resolve(__dirname, '../..');
const pathsToRemove = [
  path.join(rootDir, 'node_modules'),
  path.join(rootDir, 'test-results'),
];

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

async function main() {
  console.log('This will remove the local Playwright install state for this workspace.');
  console.log('It removes:');
  console.log('- node_modules');
  console.log('- test-results');
  console.log('');
  console.log('It does not remove tracked source files or saved auth state.');

  const answer = await ask('Type "reset" to continue or anything else to cancel:');

  if (answer !== 'reset') {
    console.log('Canceled.');
    return;
  }

  for (const target of pathsToRemove) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`Removed ${path.relative(process.cwd(), target)}`);
    }
  }

  console.log('Workspace reset complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
