import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadDownloadRequest } from '../src/utils/uploadDownload.ts';

test('builds attachment URL for signed local upload URLs', () => {
  const request = buildUploadDownloadRequest(
    'http://localhost:3000/api/v1/delivery-seller/upload/private/delivery/products/a.webp?expires=1&sig=abc',
    '商品图片',
    '/api/v1',
  );

  assert.equal(
    request.href,
    'http://localhost:3000/api/v1/delivery-seller/upload/private/delivery/products/a.webp?expires=1&sig=abc&download=1&filename=%E5%95%86%E5%93%81%E5%9B%BE%E7%89%87.webp',
  );
  assert.equal(request.filename, '商品图片.webp');
});

test('builds proxy download URL for delivery public local uploads', () => {
  const request = buildUploadDownloadRequest(
    'http://localhost:3000/uploads/delivery/products/a.webp',
    '配送商品图片',
    'http://localhost:3000/api/v1',
  );

  assert.equal(
    request.href,
    'http://localhost:3000/api/v1/delivery-seller/upload/download?key=delivery%2Fproducts%2Fa.webp&filename=%E9%85%8D%E9%80%81%E5%95%86%E5%93%81%E5%9B%BE%E7%89%87.webp',
  );
  assert.equal(request.filename, '配送商品图片.webp');
});

test('extracts delivery upload key from OSS object URL and routes through backend download endpoint', () => {
  const request = buildUploadDownloadRequest(
    'https://bucket.oss-cn-hangzhou.aliyuncs.com/delivery/products/company-cert.webp?Expires=1&Signature=x',
    '配送资质图',
    '/api/v1',
  );

  assert.equal(
    request.href,
    '/api/v1/delivery-seller/upload/download?key=delivery%2Fproducts%2Fcompany-cert.webp&filename=%E9%85%8D%E9%80%81%E8%B5%84%E8%B4%A8%E5%9B%BE.webp',
  );
  assert.equal(request.filename, '配送资质图.webp');
});

test('routes delivery waybill PDFs through the backend download endpoint', () => {
  const request = buildUploadDownloadRequest(
    'https://bucket.oss-cn-hangzhou.aliyuncs.com/delivery/waybills/SF123.pdf?Expires=1&Signature=x',
    '配送面单-SF123',
    '/api/v1',
  );

  assert.equal(
    request.href,
    '/api/v1/delivery-seller/upload/download?key=delivery%2Fwaybills%2FSF123.pdf&filename=%E9%85%8D%E9%80%81%E9%9D%A2%E5%8D%95-SF123.pdf',
  );
  assert.equal(request.filename, '配送面单-SF123.pdf');
});

test('routes delivery manifest files through the backend download endpoint', () => {
  const request = buildUploadDownloadRequest(
    'https://bucket.oss-cn-hangzhou.aliyuncs.com/delivery/manifests/seller-fulfillment/order-1.pdf',
    '配送清单-order-1',
    '/api/v1',
  );

  assert.equal(
    request.href,
    '/api/v1/delivery-seller/upload/download?key=delivery%2Fmanifests%2Fseller-fulfillment%2Forder-1.pdf&filename=%E9%85%8D%E9%80%81%E6%B8%85%E5%8D%95-order-1.pdf',
  );
  assert.equal(request.filename, '配送清单-order-1.pdf');
});

test('routes delivery settlement files through the backend download endpoint', () => {
  const request = buildUploadDownloadRequest(
    'https://bucket.oss-cn-hangzhou.aliyuncs.com/delivery/settlements/merchant-1.csv',
    '配送财务清单-merchant-1',
    '/api/v1',
  );

  assert.equal(
    request.href,
    '/api/v1/delivery-seller/upload/download?key=delivery%2Fsettlements%2Fmerchant-1.csv&filename=%E9%85%8D%E9%80%81%E8%B4%A2%E5%8A%A1%E6%B8%85%E5%8D%95-merchant-1.csv',
  );
  assert.equal(request.filename, '配送财务清单-merchant-1.csv');
});

test('keeps protected delivery-seller download paths on the authenticated backend endpoint', () => {
  const request = buildUploadDownloadRequest(
    '/delivery-seller/upload/download?key=delivery%2Fmanifests%2Fseller-finance%2Fmerchant-1.xls',
    '配送财务清单',
    '/api/v1',
  );

  assert.equal(
    request.href,
    '/api/v1/delivery-seller/upload/download?key=delivery%2Fmanifests%2Fseller-finance%2Fmerchant-1.xls&filename=%E9%85%8D%E9%80%81%E8%B4%A2%E5%8A%A1%E6%B8%85%E5%8D%95.xls',
  );
  assert.equal(request.filename, '配送财务清单.xls');
});

test('rejects non-delivery upload URLs when no delivery namespace key is present', () => {
  assert.throws(
    () =>
      buildUploadDownloadRequest(
        'http://localhost:3000/uploads/documents/license.pdf',
        '营业执照',
        'http://localhost:3000/api/v1',
      ),
    /UNSUPPORTED_UPLOAD_URL/,
  );
});
