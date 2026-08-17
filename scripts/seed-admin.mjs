// 首次部署时，用环境变量里的管理员账号在 D1 中创建管理员（若不存在）。
// 密码哈希参数必须与 src/auth.ts 完全一致：PBKDF2-SHA256, 100000 次, 32 字节输出, 16 字节盐。
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const email = process.env.ADMIN_EMAIL;
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('缺少环境变量：ADMIN_EMAIL / ADMIN_PASSWORD（在 GitHub Secrets 或本地 shell 中设置）');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const passHash = salt.toString('hex') + ':' + hash.toString('hex');

const esc = (s) => s.replace(/'/g, "''");
const sql =
  `INSERT OR IGNORE INTO users (username, email, pass_hash, role, created_at) ` +
  `VALUES ('${esc(username)}', '${esc(email)}', '${passHash}', 'admin', strftime('%s','now'));\n`;

writeFileSync('/tmp/seed-admin.sql', sql);

const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'workerbbs', '--remote', '--file=/tmp/seed-admin.sql'], {
  stdio: 'inherit',
  env: process.env,
});
if (r.status !== 0) {
  console.error('创建管理员失败（请确认 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 已设置且 wrangler 可访问 D1）。');
  process.exit(r.status ?? 1);
}
console.log('管理员账号就绪：', username, email);
