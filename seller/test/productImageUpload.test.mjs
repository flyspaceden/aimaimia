import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const uploadUtility = readFileSync('src/utils/productImageUpload.ts', 'utf8');
const uploadApi = readFileSync('src/api/mediaAssets.ts', 'utf8');
const editPage = readFileSync('src/pages/products/edit.tsx', 'utf8');

test('managed product image uploads enforce compatible dimensions and preserve the local original', () => {
  assert.match(uploadUtility, /PRODUCT_IMAGE_MAX_DIMENSION = 4096/);
  assert.match(uploadUtility, /PRODUCT_IMAGE_CLIENT_DECODE_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(uploadUtility, /PRODUCT_IMAGE_MAX_PIXELS = 40_000_000/);
  assert.match(uploadUtility, /Math\.sqrt\(PRODUCT_IMAGE_MAX_PIXELS \/ \(width \* height\)\)/);
  assert.match(uploadUtility, /new File\(\[output\], file\.name/);
  assert.match(editPage, /你电脑里的原图没有被修改/);
});

test('managed product image uploads use a dedicated timeout and visible staged progress', () => {
  assert.match(uploadApi, /timeout: 120_000/);
  assert.match(uploadApi, /onUploadProgress/);
  assert.doesNotMatch(editPage, /processingProgress|displayedPercent/);
  assert.match(editPage, /onProgress\?\.\(networkPercent\)/);
  assert.match(editPage, /服务器正在处理，请稍候/);
  assert.match(editPage, /file.status === 'uploading' && uploadFeedback\[file.uid\]/);
  assert.match(editPage, /重新上传/);
  assert.doesNotMatch(editPage, /accept="image\/\*"/);
});
