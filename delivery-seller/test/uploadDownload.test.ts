import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadDownloadRequest } from '../src/utils/uploadDownload.ts';

test('builds attachment URL for signed local upload URLs', () => {
  const request = buildUploadDownloadRequest(
    'http://localhost:3000/api/v1/upload/private/products/a.webp?expires=1&sig=abc',
    '商品图片',
    '/api/v1',
  );

  assert.equal(
    request.href,
    'http://localhost:3000/api/v1/upload/private/products/a.webp?expires=1&sig=abc&download=1&filename=%E5%95%86%E5%93%81%E5%9B%BE%E7%89%87.webp',
  );
  assert.equal(request.filename, '商品图片.webp');
});

test('builds proxy download URL for public local uploads', () => {
  const request = buildUploadDownloadRequest(
    'http://localhost:3000/uploads/documents/license.pdf',
    '营业执照',
    'http://localhost:3000/api/v1',
  );

  assert.equal(
    request.href,
    'http://localhost:3000/api/v1/upload/download?key=documents%2Flicense.pdf&filename=%E8%90%A5%E4%B8%9A%E6%89%A7%E7%85%A7.pdf',
  );
  assert.equal(request.filename, '营业执照.pdf');
});

test('extracts upload key from OSS object URL and routes through backend download endpoint', () => {
  const request = buildUploadDownloadRequest(
    'https://bucket.oss-cn-hangzhou.aliyuncs.com/documents/company-cert.pdf?Expires=1&Signature=x',
    '资质文档',
    '/api/v1',
  );

  assert.equal(
    request.href,
    '/api/v1/upload/download?key=documents%2Fcompany-cert.pdf&filename=%E8%B5%84%E8%B4%A8%E6%96%87%E6%A1%A3.pdf',
  );
  assert.equal(request.filename, '资质文档.pdf');
});
