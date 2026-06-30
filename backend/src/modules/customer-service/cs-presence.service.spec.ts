import { CsPresenceService } from './cs-presence.service';

describe('CsPresenceService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps HTTP polling presence active only until the TTL expires', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));
    const service = new CsPresenceService();

    service.markUserActiveInSession('s1', 'u1');

    expect(service.isUserInSession('s1', 'u1')).toBe(true);
    jest.advanceTimersByTime(14_999);
    expect(service.isUserInSession('s1', 'u1')).toBe(true);
    jest.advanceTimersByTime(2);
    expect(service.isUserInSession('s1', 'u1')).toBe(false);
  });

  it('keeps socket presence active until that socket disconnects', () => {
    const service = new CsPresenceService();

    service.markUserInSession('s1', 'u1', 'socket-1');
    expect(service.isUserInSession('s1', 'u1')).toBe(true);

    service.markSocketDisconnected('socket-1');
    expect(service.isUserInSession('s1', 'u1')).toBe(false);
  });
});
