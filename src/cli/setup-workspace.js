const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('Installing package dependencies...');
run('npm', ['install']);

console.log('\nInstalling Playwright browsers...');
run('npx', ['playwright', 'install']);

console.log('\nWorkspace setup complete.');
