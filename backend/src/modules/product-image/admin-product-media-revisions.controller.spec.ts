import { AdminProductMediaRevisionsController } from './admin-product-media-revisions.controller';

describe('AdminProductMediaRevisionsController', () => {
  it('lists published media changes and delegates a reasoned rollback', async () => {
    const revisions = {
      listPublishedForAdmin: jest.fn().mockResolvedValue([{ id: 'revision-1' }]),
      getForAdmin: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      rollbackPublished: jest.fn().mockResolvedValue({ rolledBack: true, revisionId: 'revision-1' }),
    };
    const controller = new AdminProductMediaRevisionsController(revisions as any);

    await expect(controller.listPublished()).resolves.toEqual([{ id: 'revision-1' }]);
    await expect(controller.rollback('revision-1', 'admin-1', '包装文字与实物不一致')).resolves.toEqual({ rolledBack: true, revisionId: 'revision-1' });
    expect(revisions.rollbackPublished).toHaveBeenCalledWith('revision-1', 'admin-1', '包装文字与实物不一致');
  });
});
