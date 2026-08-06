export const FREE_FEATURES = [
  'Local plan indexing & search',
  'All agent adapters',
  'Full source access',
  'No accounts required',
];

export const PRO_FEATURES = [
  'Everything in Self-Hosted',
  'Cloud sync via CLI daemon',
  'Shareable plan links',
  'Comment threads',
  'Technology dependency charts',
  'New plan tracking & indicators',
  'Plan creation from dashboard',
  'Up to 5 workspace members',
  'Access from any device',
];

export const PRIMARY_RGB_FALLBACK = '139, 92, 246';
export const PRIMARY_CONTRAST_FALLBACK = '#121610';

export const MONTHLY_PRICE = 7;
export const YEARLY_PRICE = 69;

export const SETTINGS_TABS = [
  { id: 'account', label: 'Account', enabled: true },
  { id: 'team', label: 'Team', enabled: true },
  { id: 'runtime', label: 'Runtime', enabled: true },
  { id: 'updates', label: 'Updates', enabled: true },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
  enabled: boolean;
};
