/**
 * 推荐码生成工具
 *
 * 格式：8 位字符，字符集排除 I/L/0/1（避免视觉混淆）
 * 字符空间 32^8 ≈ 1.1T，配合 MemberProfile.referralCode @unique 约束足够稀疏
 *
 * 使用方：所有创建 User + MemberProfile 的入口（auth/admin/seller/bonus 模块）
 * 必须用此函数生成 referralCode；@unique 冲突由调用方自行重试
 */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
