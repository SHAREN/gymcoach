import { describe, it, expect } from 'vitest';
import {
  DECOUPLING_MAX_SAMPLE_GAP_SEC,
  DECOUPLING_MAX_STATIONARY_GAP_SEC,
  DECOUPLING_MIN_DURATION_SEC,
  formatCardioSet,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  isCardioSet,
  MAX_DURATION_SEC,
  paceSecPerKm,
  parseDurationToSec,
  speedKmh,
  sumCardioWorkingSets,
  trackDecoupling,
} from './cardio';

describe('isCardioSet', () => {
  it('is true only when durationSec is set', () => {
    expect(isCardioSet({ durationSec: 600 })).toBe(true);
    expect(isCardioSet({ durationSec: null })).toBe(false);
    expect(isCardioSet({})).toBe(false);
  });
});

describe('parseDurationToSec', () => {
  it('parses mm:ss', () => {
    expect(parseDurationToSec('12:30')).toBe(750);
    expect(parseDurationToSec('0:45')).toBe(45);
  });

  it('parses h:mm:ss', () => {
    expect(parseDurationToSec('1:05:00')).toBe(3900);
  });

  it('parses plain digits as minutes', () => {
    expect(parseDurationToSec('45')).toBe(2700);
    expect(parseDurationToSec(' 5 ')).toBe(300);
  });

  it('rejects invalid or out-of-bounds input', () => {
    expect(parseDurationToSec('')).toBeNull();
    expect(parseDurationToSec('abc')).toBeNull();
    expect(parseDurationToSec('12:75')).toBeNull();
    expect(parseDurationToSec('-5')).toBeNull();
    expect(parseDurationToSec('0:00')).toBeNull(); // below 1 second
    expect(parseDurationToSec('999:00:00')).toBeNull(); // over 24h
  });

  it('round-trips with formatDuration', () => {
    for (const sec of [45, 750, 3600, 3900, MAX_DURATION_SEC]) {
      expect(parseDurationToSec(formatDuration(sec))).toBe(sec);
    }
  });
});

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(750)).toBe('12:30');
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3900)).toBe('1:05:00');
    expect(formatDuration(3600)).toBe('1:00:00');
  });
});

describe('formatDistance', () => {
  it('renders kilometers with up to 2 decimals, trimmed', () => {
    expect(formatDistance(2500)).toBe('2.5 km');
    expect(formatDistance(10000)).toBe('10 km');
    expect(formatDistance(21097.5)).toBe('21.1 km');
  });
});

describe('formatCardioSet', () => {
  it('shows duration and distance when both are present', () => {
    expect(formatCardioSet(750, 2500)).toBe('12:30 · 2.5 km');
  });

  it('shows duration only when distance is absent or zero', () => {
    expect(formatCardioSet(750, null)).toBe('12:30');
    expect(formatCardioSet(750, 0)).toBe('12:30');
  });
});

describe('paceSecPerKm', () => {
  it('derives seconds per kilometer', () => {
    // 30:00 over 5 km -> 6:00 /km.
    expect(paceSecPerKm(1800, 5000)).toBe(360);
  });

  it('returns null for zero/absent distance (no divide-by-zero)', () => {
    expect(paceSecPerKm(1800, 0)).toBeNull();
    expect(paceSecPerKm(1800, null)).toBeNull();
    expect(paceSecPerKm(1800, undefined)).toBeNull();
  });
});

describe('speedKmh', () => {
  it('derives kilometers per hour', () => {
    // 5 km in 30:00 -> 10 km/h.
    expect(speedKmh(1800, 5000)).toBe(10);
  });

  it('returns null for zero/absent distance or zero duration', () => {
    expect(speedKmh(1800, 0)).toBeNull();
    expect(speedKmh(1800, null)).toBeNull();
    expect(speedKmh(0, 5000)).toBeNull();
  });
});

describe('formatPace', () => {
  it('formats metric pace as mm:ss /km', () => {
    expect(formatPace(1800, 5000, 'KG')).toBe('6:00 /km');
  });

  it('formats imperial pace as mm:ss /mi', () => {
    // 6:00 /km -> 6:00 * 1.60934 = 579.4 s/mi -> 9:39.
    expect(formatPace(1800, 5000, 'LB')).toBe('9:39 /mi');
  });

  it('returns null when there is no distance', () => {
    expect(formatPace(1800, 0, 'KG')).toBeNull();
    expect(formatPace(1800, null, 'LB')).toBeNull();
  });
});

describe('formatSpeed', () => {
  it('formats metric speed as km/h', () => {
    expect(formatSpeed(1800, 5000, 'KG')).toBe('10 km/h');
  });

  it('formats imperial speed as mph', () => {
    // 10 km/h -> 10 / 1.60934 = 6.21 mph -> 6.2.
    expect(formatSpeed(1800, 5000, 'LB')).toBe('6.2 mph');
  });

  it('returns null when there is no distance', () => {
    expect(formatSpeed(1800, 0, 'KG')).toBeNull();
    expect(formatSpeed(1800, null, 'LB')).toBeNull();
  });
});

describe('sumCardioWorkingSets (issue #183)', () => {
  it('excludes warmup sets from the duration and distance totals', () => {
    const sets = [
      { durationSec: 300, distanceM: 800, isWarmup: true }, // warmup, excluded
      { durationSec: 1800, distanceM: 5000, isWarmup: false },
      { durationSec: 600, distanceM: 2000, isWarmup: false },
    ];
    expect(sumCardioWorkingSets(sets)).toEqual({ durationSec: 2400, distanceM: 7000 });
  });

  it('treats absent duration/distance as 0 and handles an all-warmup list', () => {
    expect(sumCardioWorkingSets([{ durationSec: 1800, distanceM: null, isWarmup: false }])).toEqual(
      { durationSec: 1800, distanceM: 0 },
    );
    expect(sumCardioWorkingSets([{ durationSec: 300, distanceM: 800, isWarmup: true }])).toEqual({
      durationSec: 0,
      distanceM: 0,
    });
  });
});

describe('trackDecoupling', () => {
  const steadyTrack = Array.from({ length: 11 }, (_, index) => {
    const t = index * DECOUPLING_MAX_SAMPLE_GAP_SEC;
    return { t, d: t * 3, hr: 150 };
  });

  it('returns zero when speed and time-weighted HR are unchanged', () => {
    expect(trackDecoupling(steadyTrack)).toBeCloseTo(0, 8);
  });

  it('reports a positive change when HR cost rises at the same speed', () => {
    const track = steadyTrack.map((point) => ({
      ...point,
      hr: 140 + (point.t / DECOUPLING_MIN_DURATION_SEC) * 14,
    }));
    expect(trackDecoupling(track)).toBeGreaterThan(0);
  });

  it('reports a positive change when pace slows at the same HR', () => {
    const track = steadyTrack.map((point) => ({
      ...point,
      d: point.t <= 600 ? point.t * 3 : 1800 + (point.t - 600) * 2,
    }));
    expect(trackDecoupling(track)).toBeCloseTo(50, 8);
  });

  it('keeps a large negative change as a finite descriptive result', () => {
    const track = steadyTrack.map((point) => ({
      ...point,
      d: point.t <= 600 ? point.t : 600 + (point.t - 600) * 4,
    }));
    expect(trackDecoupling(track)).toBeCloseTo(-75, 8);
  });

  it('interpolates the exact elapsed-time midpoint when no sample lands on it', () => {
    const times = [0, 120, 240, 360, 480, 590, 610, 720, 840, 960, 1080, 1200];
    const track = times.map((t) => ({
      t,
      d: t <= 590 ? t * 2 : 1180 + (t - 590) * 3,
      hr: 150,
    }));
    expect(trackDecoupling(track)).toBeCloseTo(-32.7778, 4);
  });

  it('is stable across regular and irregular sampling of the same linear signals', () => {
    const buildPoint = (t: number) => ({ t, d: t * 2, hr: 120 + t / 100 });
    const regular = Array.from({ length: 11 }, (_, index) =>
      buildPoint(index * DECOUPLING_MAX_SAMPLE_GAP_SEC),
    );
    const irregular = [0, 70, 190, 310, 430, 550, 600, 690, 810, 930, 1050, 1170, 1200].map(
      buildPoint,
    );
    expect(trackDecoupling(irregular)).toBeCloseTo(trackDecoupling(regular)!, 8);
  });

  it('interpolates bounded missing samples without arithmetic sample-density bias', () => {
    const track = Array.from({ length: 21 }, (_, index) => {
      const t = index * 60;
      return {
        t,
        d: t * 2,
        ...(index % 2 === 0 ? { hr: 130 + t / 200 } : {}),
      };
    });
    expect(trackDecoupling(track)).not.toBeNull();
  });

  it('rejects duplicate and out-of-order timestamps instead of sorting them', () => {
    const duplicate = steadyTrack.map((point) => ({ ...point }));
    duplicate[5]!.t = duplicate[4]!.t;
    expect(trackDecoupling(duplicate)).toBeNull();

    const reversed = steadyTrack.map((point) => ({ ...point }));
    [reversed[4], reversed[5]] = [reversed[5]!, reversed[4]!];
    expect(trackDecoupling(reversed)).toBeNull();
  });

  it('rejects decreasing or reset cumulative distance', () => {
    const track = steadyTrack.map((point) => ({ ...point }));
    track[6]!.d = track[5]!.d - 1;
    expect(trackDecoupling(track)).toBeNull();
  });

  it('rejects long HR or distance gaps while accepting the exact gap boundary', () => {
    expect(trackDecoupling(steadyTrack)).not.toBeNull();

    const longHrGap = steadyTrack.map((point, index) =>
      index === 5 ? { t: point.t, d: point.d } : { ...point },
    );
    expect(trackDecoupling(longHrGap)).toBeNull();

    const longDistanceGap = steadyTrack.map((point, index) =>
      index === 5 ? { t: point.t, hr: point.hr } : { ...point },
    );
    expect(trackDecoupling(longDistanceGap)).toBeNull();
  });

  it('rejects missing endpoint coverage for HR or distance', () => {
    expect(
      trackDecoupling(steadyTrack.map((point, index) => (index === 0 ? { t: 0 } : point))),
    ).toBeNull();
    expect(
      trackDecoupling(
        steadyTrack.map((point, index) =>
          index === steadyTrack.length - 1 ? { t: point.t, d: point.d } : point,
        ),
      ),
    ).toBeNull();
  });

  it('rejects a stationary span longer than the configured allowance', () => {
    const track = Array.from({ length: 41 }, (_, index) => {
      const t = index * DECOUPLING_MAX_STATIONARY_GAP_SEC;
      return { t, d: t * 2, hr: 150 };
    });
    track[11]!.d = track[10]!.d;
    track[12]!.d = track[10]!.d;
    expect(trackDecoupling(track)).toBeNull();
  });

  it('rejects short, degenerate and malformed tracks', () => {
    const shortTrack = Array.from({ length: 11 }, (_, index) => {
      const t = index * ((DECOUPLING_MIN_DURATION_SEC - 1) / 10);
      return { t, d: t * 2, hr: 150 };
    });
    expect(trackDecoupling(shortTrack)).toBeNull();

    expect(trackDecoupling(steadyTrack.map((point) => ({ ...point, d: 0 })))).toBeNull();
    expect(trackDecoupling(steadyTrack.map((point) => ({ ...point, hr: Number.NaN })))).toBeNull();
    expect(
      trackDecoupling(steadyTrack.map((point) => ({ ...point, d: Number.POSITIVE_INFINITY }))),
    ).toBeNull();
  });
});
