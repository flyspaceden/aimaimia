import { execSync } from 'child_process';
import path from 'path';

/**
 * 全局 setup：每次 playwright test 启动前跑一次
 * - 重置 dev 数据库（nongmai）+ 重新 seed
 * - 注意：直接作用于 DATABASE_URL 指向的 dev 库
 */
async function globalSetup() {
  if (process.env.SKIP_DB_RESET === 'true') {
    console.log('[global-setup] SKIP_DB_RESET=true，跳过数据库重置');
    return;
  }

  const backendDir = path.resolve(__dirname, '../../backend');
  console.log('[global-setup] 正在重置数据库 + 重新 seed ...');

  // 注意：该项目的 migration 历史有 AfterSaleRequest 大小写 bug（20260410010000）
  // 测试用 db push 直接对齐当前 schema，绕开 migration 链
  // 需 PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION（由调用方或 CI 设置）
  try {
    execSync('npx prisma db push --force-reset --skip-generate', {
      cwd: backendDir,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    execSync('npx prisma db seed', {
      cwd: backendDir,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    console.log('[global-setup] 数据库重置 + seed 完成');
  } catch (err) {
    console.error('[global-setup] 数据库重置失败:', err);
    throw err;
  }
}

export default globalSetup;
