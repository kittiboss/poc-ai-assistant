/** A labelled amount, used in the cost snapshot and the charge preview. */
export function ValueTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-brand border border-line-secondary bg-surface p-3">
      <p className="text-[11px] text-fg-secondary">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
