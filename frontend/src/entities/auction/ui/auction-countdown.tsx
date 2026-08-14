import { useEffect, useState } from 'react';
import { formatDateTime } from '../../../shared/lib';
import type { AuctionStatus } from '../model/auction';

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Ending…';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  // Seconds only shown under an hour left — a live ticking number past
  // that point is noise, not information.
  if (days === 0 && hours === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

// A real ticking countdown, not a static "ends at" timestamp — only
// while the auction is actually ACTIVE (a SCHEDULED/ENDED auction has
// nothing counting down). Ticks client-side only; the authoritative end
// is still whatever the backend decides (AuctionDeadlineSweeperService),
// this is purely a display convenience that can drift a few seconds from
// server clock without consequence.
export function AuctionCountdown({
  endsAt,
  status,
}: {
  endsAt: string;
  status: AuctionStatus;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== 'ACTIVE') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status]);

  if (status !== 'ACTIVE') {
    return <span>{formatDateTime(endsAt)}</span>;
  }

  return (
    <span className="auction-countdown" aria-live="off">
      {formatRemaining(new Date(endsAt).getTime() - now)}
    </span>
  );
}
