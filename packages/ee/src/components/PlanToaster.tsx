import { useTheme } from '@agendex/web';
import { Toaster } from 'sonner';

export function PlanToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme}
      visibleToasts={3}
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'relative flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] cursor-pointer',
          title: 'text-[13px] font-semibold text-text leading-snug',
          description: 'text-[12px] text-tertiary leading-snug',
          actionButton:
            'shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-[var(--accent)] hover:bg-hover transition-colors',
          closeButton:
            'absolute right-2 top-2 rounded-md p-1 text-tertiary hover:text-text hover:bg-hover transition-colors',
        },
      }}
    />
  );
}
