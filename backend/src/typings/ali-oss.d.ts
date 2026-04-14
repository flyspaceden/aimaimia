/**
 * ali-oss 最小类型声明
 * 仅覆盖本项目使用的 API：put / delete / signatureUrl
 */
declare module 'ali-oss' {
  namespace OSS {
    interface Options {
      region: string;
      accessKeyId: string;
      accessKeySecret: string;
      bucket: string;
      /** 其他可选配置 */
      [key: string]: unknown;
    }

    interface PutResult {
      /** 文件公网访问 URL */
      url: string;
      name: string;
      res: { status: number; headers: Record<string, string> };
    }

    interface SignatureUrlOptions {
      /** 签名有效期（秒） */
      expires?: number;
      /** 其他可选参数 */
      [key: string]: unknown;
    }
  }

  class OSS {
    constructor(options: OSS.Options);
    /** 上传文件到 OSS */
    put(name: string, file: Buffer | string): Promise<OSS.PutResult>;
    /** 删除 OSS 上的文件 */
    delete(name: string): Promise<{ res: { status: number } }>;
    /** 生成带签名的临时访问 URL */
    signatureUrl(name: string, options?: OSS.SignatureUrlOptions): string;
  }

  export = OSS;
}
