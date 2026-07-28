import type { RaffleLeaderboard } from "@/lib/raffle/leaderboard-core";

export function RaffleLeaderboardPanel({
  leaderboard,
}: {
  leaderboard: RaffleLeaderboard;
}) {
  return (
    <section
      className="glass-card glass-card--primary glass-pad raffle-leaderboard"
      aria-labelledby="raffleLeaderboardHeading"
    >
      <p className="sr-only" role="status" aria-live="polite">
        Leaderboard updated with {leaderboard.participantCount}{" "}
        {leaderboard.participantCount === 1 ? "member" : "members"}.
      </p>
      <p className="kicker">Verified guild members</p>
      <h2 className="section-title" id="raffleLeaderboardHeading">
        Monthly leaderboard
      </h2>
      <p>Each point is one raffle entry.</p>
      {leaderboard.entries.length ? (
        <ol className="raffle-leaderboard-list">
          {leaderboard.entries.map((entry, index) => (
            <li
              className={entry.isViewer
                ? "raffle-leaderboard-row raffle-leaderboard-row--viewer"
                : "raffle-leaderboard-row"}
              key={`${entry.rank}:${entry.displayName}:${entry.entryCount}:${index}`}
              aria-current={entry.isViewer ? "true" : undefined}
            >
              <span aria-label={`Rank ${entry.rank}`}>#{entry.rank}</span>
              <strong>{entry.displayName}</strong>
              <span>
                {entry.entryCount}{" "}
                {entry.entryCount === 1 ? "point" : "points"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted u-mt-18">
          No verified entries have been recorded for this drawing yet.
        </p>
      )}
      {leaderboard.participantCount > leaderboard.entries.length ? (
        <p className="muted raffle-leaderboard-limit">
          Showing the first {leaderboard.entries.length} of{" "}
          {leaderboard.participantCount} members.
        </p>
      ) : null}
    </section>
  );
}
