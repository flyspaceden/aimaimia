import {
  DeliveryManifestFormat,
  DeliveryManifestTemplateType,
} from '../../../generated/delivery-client';

export type DeliveryManifestApiType = 'BUYER_FULL' | 'SELLER_FULFILLMENT' | 'SELLER_FINANCE';

export type DeliveryManifestColumnDefinition = {
  key: string;
  label: string;
  sortOrder: number;
  visible: boolean;
  fixed: boolean;
};

export type DeliveryManifestTemplateDefinition = {
  apiType: DeliveryManifestApiType;
  dbType: DeliveryManifestTemplateType;
  format: DeliveryManifestFormat;
  name: string;
  description: string;
  storageSlug: string;
  extension: '.pdf' | '.xls';
  mimeType: 'application/pdf' | 'application/vnd.ms-excel';
  columns: DeliveryManifestColumnDefinition[];
};

const BUYER_FULL_COLUMNS: DeliveryManifestColumnDefinition[] = [
  { key: 'orderId', label: '配送订单号', sortOrder: 10, visible: true, fixed: true },
  { key: 'unitName', label: '配送单位', sortOrder: 20, visible: true, fixed: false },
  { key: 'recipientName', label: '收货人', sortOrder: 30, visible: true, fixed: true },
  { key: 'recipientPhone', label: '联系电话', sortOrder: 40, visible: true, fixed: true },
  { key: 'detailAddress', label: '收货地址', sortOrder: 50, visible: true, fixed: true },
  { key: 'merchantName', label: '配送商家', sortOrder: 60, visible: true, fixed: false },
  { key: 'productTitle', label: '商品名称', sortOrder: 70, visible: true, fixed: true },
  { key: 'skuTitle', label: '规格', sortOrder: 80, visible: true, fixed: false },
  { key: 'quantity', label: '数量', sortOrder: 90, visible: true, fixed: true },
  { key: 'finalUnitPrice', label: '最终单价', sortOrder: 100, visible: true, fixed: true },
  { key: 'finalLineAmount', label: '商品小计', sortOrder: 110, visible: true, fixed: true },
  { key: 'paidAt', label: '支付时间', sortOrder: 120, visible: true, fixed: false },
  { key: 'note', label: '配送备注', sortOrder: 130, visible: true, fixed: false },
  { key: 'goodsAmount', label: '商品金额', sortOrder: 140, visible: true, fixed: false },
  { key: 'shippingFee', label: '配送费', sortOrder: 150, visible: true, fixed: false },
  { key: 'totalAmount', label: '支付金额', sortOrder: 160, visible: true, fixed: true },
];

const SELLER_FULFILLMENT_COLUMNS: DeliveryManifestColumnDefinition[] = [
  { key: 'orderId', label: '配送订单号', sortOrder: 10, visible: true, fixed: true },
  { key: 'subOrderId', label: '配送子订单号', sortOrder: 20, visible: true, fixed: true },
  { key: 'unitName', label: '配送单位', sortOrder: 30, visible: true, fixed: false },
  { key: 'recipientName', label: '收货人', sortOrder: 40, visible: true, fixed: true },
  { key: 'recipientPhone', label: '联系电话', sortOrder: 50, visible: true, fixed: true },
  { key: 'detailAddress', label: '收货地址', sortOrder: 60, visible: true, fixed: true },
  { key: 'productTitle', label: '商品名称', sortOrder: 70, visible: true, fixed: true },
  { key: 'skuTitle', label: '规格', sortOrder: 80, visible: true, fixed: false },
  { key: 'unitNameItem', label: '商品单位', sortOrder: 90, visible: true, fixed: false },
  { key: 'quantity', label: '数量', sortOrder: 100, visible: true, fixed: true },
  { key: 'paidAt', label: '支付时间', sortOrder: 110, visible: true, fixed: false },
  { key: 'note', label: '配送备注', sortOrder: 120, visible: true, fixed: false },
];

const SELLER_FINANCE_COLUMNS: DeliveryManifestColumnDefinition[] = [
  { key: 'orderId', label: '配送订单号', sortOrder: 10, visible: true, fixed: true },
  { key: 'subOrderId', label: '配送子订单号', sortOrder: 20, visible: true, fixed: true },
  { key: 'paidAt', label: '支付时间', sortOrder: 30, visible: true, fixed: false },
  { key: 'itemSummary', label: '商品明细', sortOrder: 40, visible: true, fixed: false },
  { key: 'quantity', label: '数量', sortOrder: 50, visible: true, fixed: false },
  { key: 'supplyAmount', label: '供货金额', sortOrder: 60, visible: true, fixed: true },
  { key: 'settlementAmount', label: '应结金额', sortOrder: 70, visible: true, fixed: true },
];

export const DELIVERY_MANIFEST_TEMPLATES: Record<
  DeliveryManifestApiType,
  DeliveryManifestTemplateDefinition
> = {
  BUYER_FULL: {
    apiType: 'BUYER_FULL',
    dbType: DeliveryManifestTemplateType.USER_FULL,
    format: DeliveryManifestFormat.PDF,
    name: '买家整单清单',
    description: '买家和管理后台查看的完整配送清单，包含最终售价和支付金额。',
    storageSlug: 'buyer-full',
    extension: '.pdf',
    mimeType: 'application/pdf',
    columns: BUYER_FULL_COLUMNS,
  },
  SELLER_FULFILLMENT: {
    apiType: 'SELLER_FULFILLMENT',
    dbType: DeliveryManifestTemplateType.SELLER_FULFILLMENT,
    format: DeliveryManifestFormat.PDF,
    name: '配送中心履约清单',
    description: '配送中心打印给商家配货使用，不包含任何金额、成本、售价或结算信息。',
    storageSlug: 'seller-fulfillment',
    extension: '.pdf',
    mimeType: 'application/pdf',
    columns: SELLER_FULFILLMENT_COLUMNS,
  },
  SELLER_FINANCE: {
    apiType: 'SELLER_FINANCE',
    dbType: DeliveryManifestTemplateType.SELLER_SETTLEMENT,
    format: DeliveryManifestFormat.EXCEL,
    name: '配送中心财务结算导出',
    description: '配送中心导出的财务清单，仅包含本商家的供货金额和应结金额。',
    storageSlug: 'seller-finance',
    extension: '.xls',
    mimeType: 'application/vnd.ms-excel',
    columns: SELLER_FINANCE_COLUMNS,
  },
};

export function findManifestDefinitionByDbType(dbType: DeliveryManifestTemplateType) {
  return Object.values(DELIVERY_MANIFEST_TEMPLATES).find((definition) => definition.dbType === dbType);
}
