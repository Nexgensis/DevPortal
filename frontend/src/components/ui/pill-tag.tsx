import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './utils';

// PillTag is the project-wide tag/label primitive. It renders a rounded pill
// with a 2px accent border, a soft tinted background, optional icon (or status
// dot) in a slightly-darker tinted circle on the left, and accent-colored label
// text. All tone-specific colors live in TONE — every other concern (size,
// optional icon, optional dot) is shared across tones.
//
// Use it for: status indicators, role badges, audit-log action/resource tags,
// category chips, and any other small "metadata next to a value" pill.

export type PillTone =
  | 'blue'
  | 'green'
  | 'purple'
  | 'orange'
  | 'slate'
  | 'cyan'
  | 'red'
  | 'amber';

type ToneStyles = {
  bg: string;
  border: string;
  text: string;
  iconBg: string;
  iconColor: string;
  dotColor: string;
};

// Palette tuned to match the reference set (Digital / Finance / Simple / Fast /
// Secure / Fluid) — saturated borders + text on a soft tinted background.
const TONE: Record<PillTone, ToneStyles> = {
  blue:   { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8', iconBg: '#bfdbfe', iconColor: '#2563eb', dotColor: '#2563eb' },
  green:  { bg: '#d1fae5', border: '#10b981', text: '#047857', iconBg: '#a7f3d0', iconColor: '#059669', dotColor: '#059669' },
  purple: { bg: '#ede9fe', border: '#8b5cf6', text: '#6d28d9', iconBg: '#ddd6fe', iconColor: '#7c3aed', dotColor: '#7c3aed' },
  orange: { bg: '#ffedd5', border: '#f97316', text: '#c2410c', iconBg: '#fed7aa', iconColor: '#ea580c', dotColor: '#ea580c' },
  slate:  { bg: '#e2e8f0', border: '#475569', text: '#1e293b', iconBg: '#cbd5e1', iconColor: '#334155', dotColor: '#475569' },
  cyan:   { bg: '#cffafe', border: '#06b6d4', text: '#0e7490', iconBg: '#a5f3fc', iconColor: '#0891b2', dotColor: '#0891b2' },
  red:    { bg: '#fee2e2', border: '#ef4444', text: '#b91c1c', iconBg: '#fecaca', iconColor: '#dc2626', dotColor: '#dc2626' },
  amber:  { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', iconBg: '#fde68a', iconColor: '#d97706', dotColor: '#d97706' },
};

type Size = 'sm' | 'md';

interface SizeSpec {
  padX: string; padY: string; gap: string; text: string;
  circle: number; icon: number; dot: number;
}

const SIZES: Record<Size, SizeSpec> = {
  sm: { padX: '8px',  padY: '2px', gap: '6px',  text: '11px', circle: 16, icon: 10, dot: 6 },
  md: { padX: '12px', padY: '4px', gap: '8px',  text: '12px', circle: 22, icon: 14, dot: 8 },
};

export interface PillTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  icon?: LucideIcon;
  /** Render a small status dot inside the icon circle (use when you want
   *  status-indicator semantics without picking a specific icon). */
  dot?: boolean;
  size?: Size;
  children: React.ReactNode;
}

export const PillTag = React.forwardRef<HTMLSpanElement, PillTagProps>(
  ({ tone = 'slate', icon: Icon, dot = false, size = 'md', children, className, style, ...rest }, ref) => {
    const t = TONE[tone];
    const s = SIZES[size];
    const showChip = !!Icon || dot;

    return (
      <span
        ref={ref}
        className={cn('inline-flex items-center font-medium whitespace-nowrap align-middle', className)}
        style={{
          background: t.bg,
          border: `2px solid ${t.border}`,
          color: t.text,
          borderRadius: '999px',
          paddingTop: s.padY,
          paddingBottom: s.padY,
          paddingLeft: showChip ? '4px' : s.padX,
          paddingRight: s.padX,
          gap: s.gap,
          fontSize: s.text,
          lineHeight: 1.2,
          ...style,
        }}
        {...rest}
      >
        {showChip && (
          <span
            aria-hidden
            className="inline-flex items-center justify-center shrink-0"
            style={{
              width: `${s.circle}px`,
              height: `${s.circle}px`,
              borderRadius: '999px',
              background: t.iconBg,
            }}
          >
            {Icon ? (
              <Icon style={{ width: `${s.icon}px`, height: `${s.icon}px`, color: t.iconColor }} strokeWidth={2.4} />
            ) : (
              <span
                style={{
                  width: `${s.dot}px`,
                  height: `${s.dot}px`,
                  borderRadius: '999px',
                  background: t.dotColor,
                }}
              />
            )}
          </span>
        )}
        <span className="truncate">{children}</span>
      </span>
    );
  },
);
PillTag.displayName = 'PillTag';
