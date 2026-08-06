import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { SETTINGS_TABS, type SettingsTab, type SettingsTabId } from './constants';

interface SettingsTabsProps {
  activeTab: SettingsTabId;
  onChange: (tab: SettingsTabId) => void;
  tabs?: readonly SettingsTab[];
}

export function SettingsTabs({ activeTab, onChange, tabs = SETTINGS_TABS }: SettingsTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (!activeEl) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeEl.getBoundingClientRect();
    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [activeTab, tabs, measure]);

  return (
    <div
      className="relative border-b border-border mb-8 overflow-x-auto scrollbar-none"
      role="tablist"
    >
      <div ref={containerRef} className="flex gap-0 min-w-max">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const isDisabled = !tab.enabled;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={isDisabled || undefined}
              onClick={() => {
                if (tab.enabled) onChange(tab.id);
              }}
              className={[
                'relative px-4 py-3 text-[13px] font-medium transition-colors duration-150 border-none bg-transparent cursor-pointer whitespace-nowrap',
                isActive
                  ? 'text-text'
                  : isDisabled
                    ? 'text-tertiary cursor-default opacity-50'
                    : 'text-secondary hover:text-text',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Sliding active indicator */}
      {indicator && (
        <span
          className="absolute bottom-0 h-[2px] rounded-full bg-text"
          style={{
            left: indicator.left + 16,
            width: indicator.width - 32,
            transition:
              'left 0.25s cubic-bezier(0.22, 1, 0.36, 1), width 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      )}
    </div>
  );
}
