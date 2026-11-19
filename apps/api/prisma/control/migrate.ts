import { execFileSync } from 'child_process';
import * as path from 'path';
import '../../src/common/config/env.config';

const prismaBin = path.resolve(
  __dirname,
  '../../../../node_modules/.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

execFileSync(prismaBin, ['migrate', 'deploy', '--schema=prisma/control/schema.prisma'], {
  cwd: path.resolve(__dirname, '../..'),
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
