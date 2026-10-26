export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="10" fill="none" stroke="var(--color-brass)" strokeWidth="2" />
        <circle cx="16" cy="16" r="2.6" fill="var(--color-brass)" />
        <path d="M16 2v7M16 23v7M2 16h7M23 16h7" stroke="var(--color-ink)" strokeWidth="1.6" />
      </svg>
      <span className="font-heading text-[15px] tracking-tight">Scan2World <span className="text-muted">Studio</span></span>
    </span>
  );
}
