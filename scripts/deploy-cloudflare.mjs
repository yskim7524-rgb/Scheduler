import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.d1_databases.some(database => database.database_id === '00000000-0000-0000-0000-000000000000')) {
  console.error('먼저 Cloudflare D1 데이터베이스를 만들고 wrangler.jsonc의 database_id를 설정하세요. docs/cloudflare-auth.md를 참고하세요.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy'], { stdio: 'inherit', env: process.env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
