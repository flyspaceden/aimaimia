import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from 'antd';
// The test server exposes this existing component through its transform plugin.
import { ImageUploadSection } from '../src/pages/products/edit';

const asset = (id: string) => ({ asset: { id, status: 'AVAILABLE', objectKey: id, width: 600, height: 600 }, displayUrl: `/fixture-${id}.png`, expiresAt: null });
function Harness() {
  const [files, setFiles] = useState(['A', 'B'].map((id) => ({ uid: id, name: `原图${id}.png`, status: 'done', url: asset(id).displayUrl, response: asset(id) })));
  return <App><button onClick={() => setFiles((items) => items.map((item) => ({ ...item })))}>父表单更新</button><ImageUploadSection productId="product-1" fileList={files} setFileList={setFiles} /></App>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
