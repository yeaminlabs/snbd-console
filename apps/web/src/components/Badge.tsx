export function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}
