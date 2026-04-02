/**
 * 虚拟号绑定响应 DTO
 */
export class VirtualCallBindResponseDto {
  /** 分配的虚拟号 */
  virtualNumber: string;

  /** 虚拟号过期时间（ISO 8601） */
  expireAt: string;

  /** 该订单/换货单剩余可绑定次数 */
  remainingCalls: number;
}
