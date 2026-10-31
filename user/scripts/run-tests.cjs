const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const project = resolve(__dirname, '..');
const tests = readdirSync(resolve(project, 'tests')).filter(name => name.endsWith('.test.cjs')).sort().map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...tests], { cwd: project, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
