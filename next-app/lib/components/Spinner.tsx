// Stage 1 (functional, not visual) loading indicator — replaces the bare
// "Loading…" text every page showed. A proper skeleton/visual treatment is
// deliberately deferred to the later visual-system stage.
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
