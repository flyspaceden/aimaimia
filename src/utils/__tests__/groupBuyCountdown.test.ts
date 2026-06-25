import { getGroupBuyCountdownState } from '../groupBuyCountdown';

describe('group-buy countdown state', () => {
  const now = new Date('2026-06-24T12:00:00.000Z');

  it('marks a countdown as urgent when less than one day remains', () => {
    expect(getGroupBuyCountdownState('2026-06-25T11:59:59.000Z', now)).toEqual({
      expired: false,
      urgent: true,
    });
  });

  it('keeps a countdown normal when one day or more remains', () => {
    expect(getGroupBuyCountdownState('2026-06-25T12:00:00.000Z', now)).toEqual({
      expired: false,
      urgent: false,
    });
  });

  it('marks a countdown as expired after the activity end time', () => {
    expect(getGroupBuyCountdownState('2026-06-24T11:59:59.000Z', now)).toEqual({
      expired: true,
      urgent: false,
    });
  });
});
