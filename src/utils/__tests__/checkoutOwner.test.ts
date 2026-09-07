import { checkoutAttemptForOwner, ownedCheckoutValue } from '../checkoutOwner';

describe('checkout buyer ownership transitions', () => {
  it('keeps the same buyer unknown request key and signature on rerender/refocus', () => {
    const pending = { owner: 'a', key: 'original', signature: 'unknown-request' };
    const createKey = jest.fn(() => 'new');
    expect(checkoutAttemptForOwner(pending, 'a', createKey)).toBe(pending);
    expect(createKey).not.toHaveBeenCalled();
  });
  it('does not let buyer A unknown request prevent buyer B from starting checkout', () => {
    const previous = { owner: 'a', key: 'a-key', signature: 'unknown-request' };
    expect(checkoutAttemptForOwner(previous, 'b', () => 'b-key')).toEqual({ owner: 'b', key: 'b-key', signature: null });
    expect(previous.signature).toBe('unknown-request');
  });
  it('logout invalidates ownership even if the same user logs in before a render', () => {
    const old = { owner: 'a', key: 'old', signature: 'unknown-request' };
    const loggedOut = checkoutAttemptForOwner(old, undefined, () => 'anonymous');
    expect(checkoutAttemptForOwner(loggedOut, 'a', () => 'new')).toEqual({ owner: 'a', key: 'new', signature: null });
  });
  it('never exposes or navigates another buyer pending summary', () => {
    const entry = { owner: 'a', value: { sessionId: 'a-session', total: 100 } };
    expect(ownedCheckoutValue(entry, 'a')).toBe(entry.value);
    expect(ownedCheckoutValue(entry, 'b')).toBeNull();
    expect(ownedCheckoutValue(entry, undefined)).toBeNull();
    expect(ownedCheckoutValue(null, 'a')).toBeNull();
  });
});
