/** 收货地址 */
export interface Address {
  id: string;
  receiverName: string;
  phone: string;
  /** 行政区划标准编码（6 位区县码，如 "110101"），新建地址优先用此字段 */
  regionCode?: string;
  /** 行政区划文本（"北京市/北京市/东城区"），与 regionCode 一一对应 */
  regionText?: string;
  /** @deprecated 旧字段，由后端从 regionText 拆出兼容老数据 */
  province: string;
  /** @deprecated 旧字段，由后端从 regionText 拆出兼容老数据 */
  city: string;
  /** @deprecated 旧字段，由后端从 regionText 拆出兼容老数据 */
  district: string;
  detail: string;
  isDefault: boolean;
  createdAt: string;
}
