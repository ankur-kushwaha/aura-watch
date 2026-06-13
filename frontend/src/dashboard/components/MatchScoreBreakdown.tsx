import type { MatchScores } from '../types';

export function MatchScoreBreakdown({ scores }: { scores: MatchScores }) {
  const items: { label: string; value: number; className: string }[] = [
    { label: 'Embedding', value: scores.vectorSimilarity, className: 'text-[#a78bfa] bg-[rgba(167,139,250,0.12)] border-[rgba(167,139,250,0.2)]' },
    { label: 'Time', value: scores.timeScore, className: 'text-[#38bdf8] bg-[rgba(56,189,248,0.12)] border-[rgba(56,189,248,0.2)]' },
    { label: 'Topology', value: scores.topologyScore, className: 'text-[#34d399] bg-[rgba(52,211,153,0.12)] border-[rgba(52,211,153,0.2)]' },
  ];
  if (scores.feedbackBoost && scores.feedbackBoost > 0) {
    items.push({
      label: 'Feedback',
      value: scores.feedbackBoost,
      className: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
    });
  }
  items.push({
    label: 'Final',
    value: scores.finalScore,
    className: 'text-text-primary bg-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.12)]',
  });

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((item) => (
        <span
          key={item.label}
          className={`text-[0.58rem] px-1.5 py-0.5 rounded-full border ${item.className}`}
        >
          {item.label} {Math.round(item.value * 100)}%
        </span>
      ))}
    </div>
  );
}
