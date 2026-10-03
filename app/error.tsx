"use client";

// ---------------------------------------------------------------------------
// Themed error boundary — a render crash lands here instead of a white
// screen. Same cream-and-ink language as the wall; one button to recover.
// ---------------------------------------------------------------------------

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="err-boundary">
      <h1>ARGUS hit a snag</h1>
      <p>
        Something in the console crashed while rendering. Your vault and runner are
        untouched — this is display-side only.
      </p>
      {error?.digest && <p className="err-digest">ref · {error.digest}</p>}
      <button onClick={() => reset()}>reload the wall</button>
    </main>
  );
}
