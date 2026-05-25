import { useId } from 'react';

// The geometric orange→red hexagon "N" mark.
export function NexusMark({ className = 'h-7 w-7' }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8A2B" />
          <stop offset="1" stopColor="#F23E2E" />
        </linearGradient>
      </defs>
      <polygon points="24,2 44,14 44,34 24,46 4,34 4,14" fill={`url(#${id})`} />
      <path
        d="M16,34V14L32,34V14"
        stroke="#fff"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The full brand logo: the hexagon N inside a soft, spinning pastel "aura" halo.
export function NexusAuraLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <span className="aura-halo" aria-hidden />
      <NexusMark className="relative h-20 w-20 drop-shadow-[0_10px_28px_rgba(242,62,46,0.35)]" />
    </div>
  );
}
