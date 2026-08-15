import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowedMiniProgramScenePath, MiniProgramCodeRepo, persistMiniProgramCode, removePersistedMiniProgramCode } from '../miniProgramCode';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const unlink = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());
vi.mock('@tarojs/taro', () => ({ default: { env: { USER_DATA_PATH: '/tmp' }, getFileSystemManager: () => ({ unlink, writeFile }) } }));
vi.mock('@/api/client', () => ({ ApiClient: { get, post } }));

describe('mini program code contracts', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); unlink.mockReset(); writeFile.mockReset(); });
  it('rejects arbitrary destinations even when returned by the server', async () => {
    get.mockResolvedValue({ ok: true, data: { kind: 'REFERRAL', path: '/admin/users', expiresAt: '2027-01-01' } });
    const result = await MiniProgramCodeRepo.resolve('abcdefghijklmnopqrstuv');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_MINI_PROGRAM_CODE_RESPONSE' } });
    expect(isAllowedMiniProgramScenePath('https://evil.example')).toBe(false);
  });
  it('accepts only a valid local referral destination', async () => {
    const path = '/packages/referral/landing/index?code=SABC1234&kind=normal';
    get.mockResolvedValue({ ok: true, data: { kind: 'REFERRAL', path, expiresAt: '2027-01-01' } });
    await expect(MiniProgramCodeRepo.resolve('abcdefghijklmnopqrstuv')).resolves.toEqual({ ok: true, data: { kind: 'REFERRAL', path, expiresAt: '2027-01-01' } });
  });
  it('rejects malformed image payloads', async () => {
    post.mockResolvedValue({ ok: true, data: { scene: 'abcdefghijklmnopqrstuv', kind: 'REFERRAL', mimeType: 'text/html', imageBase64: '<html>', expiresAt: '2027-01-01' } });
    await expect(MiniProgramCodeRepo.create('REFERRAL')).resolves.toMatchObject({ ok: false });
  });
  it('accepts the JPEG mini-program code returned by the staging backend and persists it as JPEG', async () => {
    const data = {
      scene: 'abcdefghijklmnopqrstuv',
      kind: 'REFERRAL' as const,
      mimeType: 'image/jpeg' as const,
      imageBase64: '/9j/4AAQSkZJRgABAQABAAD=',
      expiresAt: '2027-01-01',
    };
    post.mockResolvedValue({ ok: true, data });
    await expect(MiniProgramCodeRepo.create('REFERRAL')).resolves.toEqual({ ok: true, data });

    writeFile.mockImplementation(({ success }) => success());
    await expect(persistMiniProgramCode(data)).resolves.toBe('/tmp/aim-mini-code-abcdefghijklmnopqrstuv.jpg');
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/aim-mini-code-abcdefghijklmnopqrstuv.jpg',
      data: data.imageBase64,
      encoding: 'base64',
    }));
  });
  it('best-effort removes a stale account code file', async () => {
    unlink.mockImplementation(({ success }) => success());
    await expect(removePersistedMiniProgramCode('/tmp/old-account.png')).resolves.toBeUndefined();
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/old-account.png' }));
  });
});
