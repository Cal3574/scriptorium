import { useState } from 'react';
import { CheckIcon, PaletteIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { THEME_OPTIONS, useTheme, type ThemeOption } from '@/theme';

function ThemeSwatches({ theme }: { theme: ThemeOption }) {
  return (
    <span className="flex overflow-hidden rounded-full border border-white/15 shadow-xs">
      {theme.swatches.map((swatch) => (
        <span
          key={swatch}
          className="size-3"
          style={{ backgroundColor: swatch }}
        />
      ))}
    </span>
  );
}

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEME_OPTIONS.find((option) => option.id === theme);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Select colour scheme, current scheme ${current?.label ?? theme}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="relative overflow-hidden"
        onClick={() => setOpen((value) => !value)}
      >
        <PaletteIcon />
        <span className="absolute right-1.5 bottom-1.5">
          {current ? <ThemeSwatches theme={current} /> : null}
        </span>
      </Button>

      {open ? (
        <div className="absolute right-0 z-(--z-dropdown) mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border/80 bg-popover p-2 text-popover-foreground shadow-sm">
          <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Colour scheme
          </p>
          <div
            className="grid grid-cols-1 gap-1.5 p-1 sm:grid-cols-2"
            role="listbox"
            aria-label="Colour schemes"
          >
            {THEME_OPTIONS.map((option) => {
              const selected = option.id === theme;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setTheme(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'group rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45',
                    selected
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-border bg-card/70',
                  )}
                >
                  <span className="mb-3 flex items-center justify-between gap-3">
                    <ThemeSwatches theme={option} />
                    {selected ? (
                      <CheckIcon className="size-4 text-primary" />
                    ) : null}
                  </span>
                  <span className="block text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {option.tone}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
