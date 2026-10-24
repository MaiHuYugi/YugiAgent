import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--watch', 'server.js'], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => { process.exitCode = code ?? 0; });
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
