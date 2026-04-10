import { SETTINGS_TABS, type SettingsTabId } from './constants';

interface SettingsTabsProps {
  activeTab: SettingsTabId;
  onChange: (tab: SettingsTabId) => void;
}

export function SettingsTabs({ activeTab, onChange }: SettingsTabsProps) {
  return (
    <div className="border-b border-border mb-8 overflow-x-auto scrollbar-none" role="tablist">
      <div className="flex gap-0 min-w-max">
        {SETTINGS_TABS.map((tab) => {
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
              {isActive && (
                <span className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full bg-text" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
