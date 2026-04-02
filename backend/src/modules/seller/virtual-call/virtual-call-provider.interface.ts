/**
 * 虚拟号服务提供者接口
 *
 * 隐私号绑定/解绑抽象层，便于切换阿里云隐私号、腾讯云小号等实现。
 */
export interface VirtualCallProvider {
  /**
   * 绑定虚拟号
   * @param params.sellerPhone 卖家客服电话
   * @param params.buyerPhone 买家真实手机号
   * @param params.expireMinutes 有效时长（分钟）
   * @returns 虚拟号及过期时间
   */
  bindNumber(params: {
    sellerPhone: string;
    buyerPhone: string;
    expireMinutes: number;
  }): Promise<{ virtualNo: string; expireAt: Date }>;

  /**
   * 解绑虚拟号
   * @param virtualNo 需要释放的虚拟号
   */
  unbindNumber(virtualNo: string): Promise<void>;

  /**
   * 获取通话录音（可选实现）
   *
   * 从运营商/云通信平台拉取指定绑定的通话录音信息。
   * 未实现此方法的 Provider 将返回 null。
   *
   * TODO: 对接阿里云隐私号录音下载 / 腾讯云小号录音接口
   *
   * @param bindingId 虚拟号绑定记录 ID
   * @returns 录音 URL 和时长（秒），无录音时返回 null
   */
  getCallRecording?(
    bindingId: string,
  ): Promise<{ recordingUrl: string; duration: number } | null>;
}

/** 依赖注入 Token */
export const VIRTUAL_CALL_PROVIDER = 'VIRTUAL_CALL_PROVIDER';
