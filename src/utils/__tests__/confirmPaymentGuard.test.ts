const mockActiveQuery = jest.fn();
const mockStatus = jest.fn();
const mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
const mockShow = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }), { virtual: true });
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('../../repos', () => ({ OrderRepo: { activeQueryPayment: (...args: unknown[]) => mockActiveQuery(...args), getCheckoutSessionStatus: (...args: unknown[]) => mockStatus(...args) } }));
jest.mock('../../components/feedback', () => ({ useToast: () => ({ show: mockShow }) }));
import { useConfirmPayment } from '../../hooks/useConfirmPayment';

describe('payment confirmation ownership guard', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it('does not start a query for an obsolete owner', async () => {
    expect(await useConfirmPayment()({ sessionId: 'A', sdkResultStatus: '', isCurrent: () => false })).toEqual({ outcome: 'abandoned' });
    expect(mockActiveQuery).not.toHaveBeenCalled();
  });
  it('ignores completed response after account or page generation changes', async () => {
    let current = true;
    let finish!: (value: unknown) => void;
    mockActiveQuery.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onSuccess = jest.fn();
    const task = useConfirmPayment()({ sessionId: 'A', sdkResultStatus: '', isCurrent: () => current, onSuccess });
    current = false;
    finish({ ok: true, data: { status: 'COMPLETED' } });
    expect(await task).toEqual({ outcome: 'abandoned' });
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
  it('stops polling after losing ownership during the wait', async () => {
    jest.useFakeTimers();
    let current = true;
    mockActiveQuery.mockResolvedValue({ ok: true, data: { status: 'ACTIVE' } });
    const task = useConfirmPayment()({ sessionId: 'A', sdkResultStatus: '', isCurrent: () => current });
    await Promise.resolve(); await Promise.resolve();
    current = false;
    await jest.advanceTimersByTimeAsync(2000);
    expect(await task).toEqual({ outcome: 'abandoned' });
    expect(mockStatus).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  it('preserves old callers cancellation behavior', async () => {
    expect(await useConfirmPayment()({ sessionId: 'A', sdkResultStatus: '6001' })).toEqual({ outcome: '6001-canceled' });
    expect(mockActiveQuery).not.toHaveBeenCalled();
  });
});
