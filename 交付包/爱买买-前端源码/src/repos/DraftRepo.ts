/**
 * 发帖草稿仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/postDrafts.ts` 作为草稿箱数据源
 *
 * 后端接入说明：
 * - 草稿属于“用户私有数据”，建议要求鉴权（token），并按用户隔离
 * - 建议接口：
 *   - `GET /api/v1/post-drafts`
 *   - `GET /api/v1/post-drafts/{id}`
 *   - `POST /api/v1/post-drafts`（新增/保存，带 id 视为更新也可）
 *   - `DELETE /api/v1/post-drafts/{id}`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#42-草稿箱draft`
 */
import { mockPostDrafts } from '../mocks';
import { PostDraft, PostDraftInput, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

const formatDraftTime = (value: Date) => value.toISOString().slice(0, 16).replace('T', ' ');
const toTime = (value: string) => new Date(value.replace(' ', 'T')).getTime();

// 草稿仓储：处理草稿箱列表与保存逻辑（复杂业务逻辑需中文注释）
export const DraftRepo = {
  /**
   * 草稿列表
   * - 用途：草稿箱页面
   * - 后端建议：`GET /api/v1/post-drafts`
   */
  list: async (): Promise<Result<PostDraft[]>> => {
    const sorted = [...mockPostDrafts].sort(
      (a, b) => toTime(b.updatedAt) - toTime(a.updatedAt)
    );
    return simulateRequest(sorted, { delay: 200 });
  },
  /**
   * 草稿详情
   * - 用途：从草稿箱进入编辑器
   * - 后端建议：`GET /api/v1/post-drafts/{id}`
   */
  getById: async (id: string): Promise<Result<PostDraft>> => {
    const draft = mockPostDrafts.find((item) => item.id === id);
    if (!draft) {
      return err(createAppError('NOT_FOUND', `草稿不存在: ${id}`, '草稿未找到'));
    }
    return simulateRequest(draft, { delay: 160 });
  },
  /**
   * 保存草稿（新增/更新）
   * - 用途：发布页“保存草稿”/自动保存
   * - 后端建议：`POST /api/v1/post-drafts`
   * - body：`PostDraftInput`（如果带 id 则更新该草稿）
   */
  save: async (payload: PostDraftInput): Promise<Result<PostDraft>> => {
    const now = formatDraftTime(new Date());
    if (payload.id) {
      const index = mockPostDrafts.findIndex((item) => item.id === payload.id);
      if (index === -1) {
        return err(createAppError('NOT_FOUND', `草稿不存在: ${payload.id}`, '草稿未找到'));
      }
      const updated: PostDraft = {
        ...mockPostDrafts[index],
        ...payload,
        updatedAt: now,
      };
      mockPostDrafts[index] = updated;
      return simulateRequest(updated, { delay: 180 });
    }

    const draft: PostDraft = {
      ...payload,
      id: `draft-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    mockPostDrafts.unshift(draft);
    return simulateRequest(draft, { delay: 180 });
  },
  /**
   * 删除草稿
   * - 用途：草稿箱删除
   * - 后端建议：`DELETE /api/v1/post-drafts/{id}`
   */
  remove: async (id: string): Promise<Result<{ id: string }>> => {
    const index = mockPostDrafts.findIndex((item) => item.id === id);
    if (index === -1) {
      return err(createAppError('NOT_FOUND', `草稿不存在: ${id}`, '草稿未找到'));
    }
    mockPostDrafts.splice(index, 1);
    return simulateRequest({ id }, { delay: 140 });
  },
};
