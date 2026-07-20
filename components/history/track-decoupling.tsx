import { trackDecoupling } from '@/lib/cardio';
import type { TrackPoint } from '@/lib/import/track';

export interface TrackDecouplingCopy {
  title: string;
  comparison: string;
  description: string;
  limitations: string;
}

// Neutral readout for the optional pace / heart-rate change estimate. The
// calculation owns the applicability gates and returns null when the stored
// track is too short, incomplete or structurally invalid.
export function TrackDecoupling({
  track,
  locale,
  copy,
}: {
  track: TrackPoint[];
  locale: string;
  copy: TrackDecouplingCopy;
}) {
  const change = trackDecoupling(track);
  if (change == null) return null;

  const formattedChange = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(change / 100);

  return (
    <div className="mt-3 text-xs" data-testid="track-decoupling">
      <p className="font-medium text-muted-foreground">{copy.title}</p>
      <p className="mt-0.5">
        <span className="text-sm font-semibold">{formattedChange}</span>
        <span className="ml-2 text-muted-foreground">{copy.comparison}</span>
      </p>
      <p className="mt-1 text-muted-foreground">{copy.description}</p>
      <p className="mt-1 text-muted-foreground">{copy.limitations}</p>
    </div>
  );
}
