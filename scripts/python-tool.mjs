import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const pythonCandidates = process.platform === 'win32'
    ? ['.venv/Scripts/python.exe', '.venv/bin/python']
    : ['.venv/bin/python', '.venv/Scripts/python.exe'];
const python = process.env.PYTHON ?? pythonCandidates
    .map((candidate) => path.join(root, candidate))
    .find(existsSync) ?? (process.platform === 'win32' ? 'python' : 'python3');

const [tool, ...args] = process.argv.slice(2);
const tools = {
    pytest: { module: 'pytest', cwd: root },
    ruff: { module: 'ruff', cwd: root },
    mypy: { module: 'mypy', cwd: root },
    seed: { module: 'app.seed', cwd: path.join(root, 'apps/api') },
    migrate: { module: 'alembic', cwd: path.join(root, 'apps/api') },
};
const selected = tools[tool];

if (!selected) {
    console.error(`Unknown Python tool: ${tool ?? '(missing)'}`);
    process.exit(2);
}

const commandArgs = ['-m', selected.module, ...args];
const result = spawnSync(python, commandArgs, {
    cwd: selected.cwd,
    env: process.env,
    stdio: 'inherit',
});

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status ?? 1);
