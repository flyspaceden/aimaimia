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
  { key: 'orderId', label: 'Order ID', sortOrder: 10, visible: true, fixed: true },
  { key: 'unitName', label: 'Unit', sortOrder: 20, visible: true, fixed: false },
  { key: 'recipientName', label: 'Recipient', sortOrder: 30, visible: true, fixed: true },
  { key: 'recipientPhone', label: 'Recipient Phone', sortOrder: 40, visible: true, fixed: true },
  { key: 'detailAddress', label: 'Address', sortOrder: 50, visible: true, fixed: true },
  { key: 'merchantName', label: 'Merchant', sortOrder: 60, visible: true, fixed: false },
  { key: 'productTitle', label: 'Product', sortOrder: 70, visible: true, fixed: true },
  { key: 'skuTitle', label: 'SKU', sortOrder: 80, visible: true, fixed: false },
  { key: 'quantity', label: 'Qty', sortOrder: 90, visible: true, fixed: true },
  { key: 'finalUnitPrice', label: 'Final Unit Price', sortOrder: 100, visible: true, fixed: true },
  { key: 'finalLineAmount', label: 'Final Line Amount', sortOrder: 110, visible: true, fixed: true },
  { key: 'paidAt', label: 'Paid At', sortOrder: 120, visible: true, fixed: false },
  { key: 'note', label: 'Note', sortOrder: 130, visible: true, fixed: false },
  { key: 'goodsAmount', label: 'Goods Amount', sortOrder: 140, visible: true, fixed: false },
  { key: 'shippingFee', label: 'Shipping Fee', sortOrder: 150, visible: true, fixed: false },
  { key: 'totalAmount', label: 'Total Amount', sortOrder: 160, visible: true, fixed: true },
];

const SELLER_FULFILLMENT_COLUMNS: DeliveryManifestColumnDefinition[] = [
  { key: 'orderId', label: 'Order ID', sortOrder: 10, visible: true, fixed: true },
  { key: 'subOrderId', label: 'SubOrder ID', sortOrder: 20, visible: true, fixed: true },
  { key: 'unitName', label: 'Unit', sortOrder: 30, visible: true, fixed: false },
  { key: 'recipientName', label: 'Recipient', sortOrder: 40, visible: true, fixed: true },
  { key: 'recipientPhone', label: 'Recipient Phone', sortOrder: 50, visible: true, fixed: true },
  { key: 'detailAddress', label: 'Address', sortOrder: 60, visible: true, fixed: true },
  { key: 'productTitle', label: 'Product', sortOrder: 70, visible: true, fixed: true },
  { key: 'skuTitle', label: 'SKU', sortOrder: 80, visible: true, fixed: false },
  { key: 'unitNameItem', label: 'Item Unit', sortOrder: 90, visible: true, fixed: false },
  { key: 'quantity', label: 'Qty', sortOrder: 100, visible: true, fixed: true },
  { key: 'paidAt', label: 'Paid At', sortOrder: 110, visible: true, fixed: false },
  { key: 'note', label: 'Note', sortOrder: 120, visible: true, fixed: false },
];

const SELLER_FINANCE_COLUMNS: DeliveryManifestColumnDefinition[] = [
  { key: 'orderId', label: 'Order ID', sortOrder: 10, visible: true, fixed: true },
  { key: 'subOrderId', label: 'SubOrder ID', sortOrder: 20, visible: true, fixed: true },
  { key: 'paidAt', label: 'Paid At', sortOrder: 30, visible: true, fixed: false },
  { key: 'itemSummary', label: 'Items', sortOrder: 40, visible: true, fixed: false },
  { key: 'quantity', label: 'Qty', sortOrder: 50, visible: true, fixed: false },
  { key: 'supplyAmount', label: 'Supply Amount', sortOrder: 60, visible: true, fixed: true },
  { key: 'settlementAmount', label: 'Settlement Amount', sortOrder: 70, visible: true, fixed: true },
];

export const DELIVERY_MANIFEST_TEMPLATES: Record<
  DeliveryManifestApiType,
  DeliveryManifestTemplateDefinition
> = {
  BUYER_FULL: {
    apiType: 'BUYER_FULL',
    dbType: DeliveryManifestTemplateType.USER_FULL,
    format: DeliveryManifestFormat.PDF,
    name: 'Buyer Full Manifest',
    description: 'Buyer/admin full delivery manifest with final selling prices.',
    storageSlug: 'buyer-full',
    extension: '.pdf',
    mimeType: 'application/pdf',
    columns: BUYER_FULL_COLUMNS,
  },
  SELLER_FULFILLMENT: {
    apiType: 'SELLER_FULFILLMENT',
    dbType: DeliveryManifestTemplateType.SELLER_FULFILLMENT,
    format: DeliveryManifestFormat.PDF,
    name: 'Seller Fulfillment Manifest',
    description: 'Seller fulfillment PDF without finance amounts.',
    storageSlug: 'seller-fulfillment',
    extension: '.pdf',
    mimeType: 'application/pdf',
    columns: SELLER_FULFILLMENT_COLUMNS,
  },
  SELLER_FINANCE: {
    apiType: 'SELLER_FINANCE',
    dbType: DeliveryManifestTemplateType.SELLER_SETTLEMENT,
    format: DeliveryManifestFormat.EXCEL,
    name: 'Seller Finance Export',
    description: 'Seller finance export with supply and settlement amounts only.',
    storageSlug: 'seller-finance',
    extension: '.xls',
    mimeType: 'application/vnd.ms-excel',
    columns: SELLER_FINANCE_COLUMNS,
  },
};

export function findManifestDefinitionByDbType(dbType: DeliveryManifestTemplateType) {
  return Object.values(DELIVERY_MANIFEST_TEMPLATES).find((definition) => definition.dbType === dbType);
}
