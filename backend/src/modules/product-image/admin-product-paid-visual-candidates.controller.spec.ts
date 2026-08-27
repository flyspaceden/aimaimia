import { AdminProductPaidVisualCandidatesController } from './admin-product-paid-visual-candidates.controller';

describe('AdminProductPaidVisualCandidatesController', () => {
  it('delegates fact review to the candidate service and never performs publication itself', async () => {
    const candidates = {
      getForAdmin: jest.fn().mockResolvedValue({ task: { id: 'optimization-1', status: 'PENDING_REVIEW' } }),
      approveHumanFactReview: jest.fn().mockResolvedValue(undefined),
      rejectHumanFactReview: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AdminProductPaidVisualCandidatesController(candidates as any);

    await expect(controller.get('optimization-1')).resolves.toMatchObject({ task: { status: 'PENDING_REVIEW' } });
    await expect(controller.approve('optimization-1', 'admin-1')).resolves.toEqual({ approved: true });
    await expect(controller.reject('optimization-1', '文字不一致', 'admin-1')).resolves.toEqual({ rejected: true });
    expect(candidates.approveHumanFactReview).toHaveBeenCalledWith('optimization-1');
    expect(candidates.rejectHumanFactReview).toHaveBeenCalledWith('optimization-1', '文字不一致');
  });
});
