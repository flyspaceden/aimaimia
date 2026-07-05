/**
 * 推荐码生成工具
 *
 * 格式：8 位字符，字符集排除 I/L/0/1（避免视觉混淆）
 * 字符空间 32^8 ≈ 1.1T，配合 MemberProfile.referralCode @unique 约束足够稀疏
 *
 * 使用方：所有创建 User + MemberProfile 的入口（auth/admin/seller/bonus 模块）
 * 通过 pickUniqueReferralCode() 预查找一个空闲码再写入，**降低**直接随机后撞
 * @unique 约束打断注册/建号的概率（不能完全消除，见 pickUniqueReferralCode 注释）
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
  normalShareProfile?: {
    findFirst: (args: {
      where: { code: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

async function isReferralCodeOccupied(prisma: PrismaLike, code: string): Promise<boolean> {
  const existingVipCode = await prisma.memberProfile.findFirst({
    where: { referralCode: code },
    select: { id: true },
  });
  if (existingVipCode) return true;

  if (!prisma.normalShareProfile) return false;
  const existingNormalShareCode = await prisma.normalShareProfile.findFirst({
    where: { code },
    select: { id: true },
  });
  return Boolean(existingNormalShareCode);
}

/**
 * 预查找一个未占用的推荐码
 *
 * **重要：本函数只能"降低"@unique 冲突概率，无法消除残余 race。**
 * 流程：随机生成 → findFirst 查重 → 未占用则返回。
 * 32^8 ≈ 1.1T 字符空间，10 次预查全撞概率几乎为 0；
 * 超出尝试次数抛错（说明数据库或字符空间出了大问题）。
 *
 * **残余 race**：预查找与后续 create 之间没有锁。两个并发请求同时预查到
 * 同一个空闲码 → 一个 create 成功 → 第二个 create 撞 @unique 失败（P2002）。
 *
 * 调用方分两类：
 * - 已用 try/catch + retry 兜底（如 bonus.service.getMemberProfile lazy 补码）
 * - **没**做 P2002 重试（13 处建号 create 大多属于此类）：依赖 32^8 + 预查
 *   把概率压到接近 0，但理论上仍可能在并发下打断注册/建号。如果未来观测到
 *   生产 P2002 报警，再把"生成 + create"包进 retry helper（见 plan.md backlog）
 */
export async function pickUniqueReferralCode(
  prisma: PrismaLike,
  maxAttempts = 10,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateReferralCode();
    const occupied = await isReferralCodeOccupied(prisma, code);
    if (!occupied) return code;
  }
  throw new Error(`pickUniqueReferralCode: ${maxAttempts} 次尝试均冲突，数据库异常`);
}
