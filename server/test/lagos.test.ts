import { describe, expect, it } from 'vitest';

import { lagosDate, previousWeekBoundary, weekBoundaryAtOrBefore } from '../src/lib/lagos';

// Lagos is UTC+1 all year, so Friday 00:00 Lagos is Thursday 23:00 UTC.
describe('weekBoundaryAtOrBefore', () => {
  it('returns the Friday that has just started when called on a Friday morning', () => {
    const boundary = weekBoundaryAtOrBefore(new Date('2026-10-30T07:00:00Z'));

    expect(boundary.toISOString()).toBe('2026-10-29T23:00:00.000Z');
    expect(lagosDate(boundary)).toBe('2026-10-30');
  });

  it('treats Friday 00:00 Lagos as the start of the new week', () => {
    expect(weekBoundaryAtOrBefore(new Date('2026-10-22T23:00:00Z')).toISOString()).toBe(
      '2026-10-22T23:00:00.000Z',
    );
  });

  it('keeps one minute earlier in the previous week', () => {
    expect(weekBoundaryAtOrBefore(new Date('2026-10-22T22:59:00Z')).toISOString()).toBe(
      '2026-10-15T23:00:00.000Z',
    );
  });

  it('walks back to the previous Friday from mid-week', () => {
    expect(lagosDate(weekBoundaryAtOrBefore(new Date('2026-10-26T12:00:00Z')))).toBe('2026-10-23');
  });
});

describe('previousWeekBoundary', () => {
  it('steps back exactly seven days', () => {
    const friday = new Date('2026-10-29T23:00:00.000Z');

    expect(lagosDate(previousWeekBoundary(friday))).toBe('2026-10-23');
  });
});
