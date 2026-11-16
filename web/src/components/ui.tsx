import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Color, Severity } from '../lib/types';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variant === 'primary' && 'bg-accent text-[#08210f] hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line bg-panel-2 text-text hover:border-muted',
        variant === 'ghost' && 'text-muted hover:text-text hover:bg-panel-2',
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-panel p-5', className)}>{children}</div>;
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cx(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'good' && 'text-accent',
          tone === 'bad' && 'text-bad',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

const SEVERITY_STYLE: Record<Severity, string> = {
  blunder: 'bg-bad/15 text-bad',
  mistake: 'bg-warn/15 text-warn',
  inaccuracy: 'bg-info/15 text-info',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize', SEVERITY_STYLE[severity])}>{severity}</span>;
}

export function ColorDot({ color }: { color: Color }) {
  return (
    <span
      title={`You played ${color}`}
      className={cx('inline-block h-3 w-3 shrink-0 rounded-full border', color === 'white' ? 'border-white/60 bg-white' : 'border-white/40 bg-neutral-900')}
    />
  );
}

/** Win / draw / loss split as a thin stacked bar. */
export function ScoreBar({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  const total = wins + draws + losses || 1;
  return (
    <div className="flex h-2 w-full min-w-16 overflow-hidden rounded-full bg-panel-2" title={`${wins}W ${draws}D ${losses}L`}>
      <div className="bg-accent" style={{ width: `${(wins / total) * 100}%` }} />
      <div className="bg-muted/60" style={{ width: `${(draws / total) * 100}%` }} />
      <div className="bg-bad" style={{ width: `${(losses / total) * 100}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-panel-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition',
            value === o.value ? 'bg-panel text-text shadow' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="py-12 text-center">
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </Card>
  );
}
