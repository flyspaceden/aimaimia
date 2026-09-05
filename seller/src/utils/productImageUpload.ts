export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_CLIENT_DECODE_MAX_BYTES = 25 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_DIMENSION = 4096;
export const PRODUCT_IMAGE_MAX_PIXELS = 40_000_000;

export type ProductImageResizePlan = {
  width: number;
  height: number;
  shouldResize: boolean;
};

export type PreparedProductImage = {
  file: File;
  resized: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
};

const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function planProductImageResize(width: number, height: number): ProductImageResizePlan {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取图片尺寸，请重新导出为 JPG、PNG 或 WebP 后上传');
  }
  const dimensionScale = Math.min(
    1,
    PRODUCT_IMAGE_MAX_DIMENSION / width,
    PRODUCT_IMAGE_MAX_DIMENSION / height,
  );
  const pixelScale = Math.min(1, Math.sqrt(PRODUCT_IMAGE_MAX_PIXELS / (width * height)));
  const scale = Math.min(dimensionScale, pixelScale);
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  return {
    width: targetWidth,
    height: targetHeight,
    shouldResize: targetWidth !== width || targetHeight !== height,
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('浏览器无法处理这张图片，请重新导出后上传')),
      type,
      quality,
    );
  });
}

export async function prepareProductImageForUpload(file: File): Promise<PreparedProductImage> {
  if (!supportedTypes.has(file.type)) {
    throw new Error('仅支持 JPG、PNG 或 WebP 图片');
  }
  if (file.size > PRODUCT_IMAGE_CLIENT_DECODE_MAX_BYTES) {
    throw new Error('原图片超过 25MB，为保护浏览器内存，请先缩小图片后再上传');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片无法读取或内容已损坏，请重新导出后上传');
  }

  try {
    const plan = planProductImageResize(bitmap.width, bitmap.height);
    const shouldReencode = plan.shouldResize || file.size > PRODUCT_IMAGE_MAX_BYTES;
    if (!shouldReencode) {
      return {
        file,
        resized: false,
        originalWidth: bitmap.width,
        originalHeight: bitmap.height,
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d', { alpha: file.type === 'image/png' });
    if (!context) throw new Error('浏览器无法处理这张图片，请重新导出后上传');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);

    const outputType = file.type;
    const output = await canvasBlob(canvas, outputType, outputType === 'image/png' ? undefined : 0.9);
    if (output.size > PRODUCT_IMAGE_MAX_BYTES) {
      throw new Error('图片自动优化后仍超过 10MB，请缩小图片或改存为 JPG 后重新上传');
    }
    return {
      file: new File([output], file.name, { type: outputType, lastModified: file.lastModified }),
      resized: true,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      width: plan.width,
      height: plan.height,
    };
  } finally {
    bitmap.close();
  }
}
