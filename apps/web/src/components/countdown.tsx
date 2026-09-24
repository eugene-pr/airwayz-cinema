import { useEffect, useState } from "react";

// Display only: the server decides expiry (ARCHITECTURE §4). onExpire lets the page re-fetch at
// expiry instead of waiting up to a poll interval with a dead hold on screen.
export function Countdown({ until, onExpire }: { until: string; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const remaining = Date.parse(until) - Date.now();
    // Only schedule while still in the future, so an already-expired hold can't re-fire every render.
    if (!onExpire || remaining <= 0) return;
    const timer = setTimeout(onExpire, remaining);
    return () => clearTimeout(timer);
  }, [until, onExpire]);

  const seconds = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return <time dateTime={until}>{seconds > 0 ? `${mm}:${ss}` : "expired"}</time>;
}
