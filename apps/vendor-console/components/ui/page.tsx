import type { ReactNode } from 'react';

/** A page's content area: what the page is for, its actions, then its content. */
export function Page({ intro, actions, children }: { intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 md:gap-6 md:p-6">
      {(intro || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {intro && <p className="max-w-3xl text-sm leading-6 text-fg-secondary">{intro}</p>}
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
