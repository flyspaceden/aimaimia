/**
 * 推荐码生成工具
 *
 * 格式：8 位字符，字符集排除 I/L/0/1（避免视觉混淆）
 * 字符空间 32^8 ≈ 1.1T，配合 MemberProfile.referralCode @unique 约束足够稀疏
 *
 * 使用方：所有创建 User + MemberProfile 的入口（auth/admin/seller/bonus 模块）
 * 通过 pickUniqueReferralCode() 预查找拿到一个空闲码，避免直接 generateReferralCode
 * 后撞 @unique 约束打断注册/建号
 */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Prisma 客户端最小契约（兼容 PrismaService 与事务客户端 Prisma.TransactionClient）
 */
type PrismaLike = {
  memberProfile: {
    findFirst: (args: {
      where: { referralCode: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

/**
 * 预查找一个不冲突的推荐码
 *
 * 32^8 ≈ 1.1T 字符空间，10 次随机生成都撞码的概率几乎为 0；
 * 兜底超出尝试次数则抛错（说明数据库或字符空间出了大问题）。
 *
 * 调用方仍依赖 @unique 约束做最终保护——预查找与 create 之间存在 race，
 * 若并发命中同码，第二个 create 会 P2002，调用方需要捕获并重试或上报。
 */
export async function pickUniqueReferralCode(
  prisma: PrismaLike,
  maxAttempts = 10,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateReferralCode();
    const existing = await prisma.memberProfile.findFirst({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error(`pickUniqueReferralCode: ${maxAttempts} 次尝试均冲突，数据库异常`);
}
