// 简单延迟工具：用于模拟网络请求
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
