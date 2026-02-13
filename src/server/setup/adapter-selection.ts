import { autocompleteMultiselect, cancel, intro, isCancel, outro } from '@clack/prompts';
import {
  getCatalog,
  getDefaultAdapterIds,
  sanitizeEnabledAdapterIds,
} from '../adapters/registry.ts';
import { type AdapterId } from '../adapters/catalog.ts';

export interface AdapterSelectionOptions {
  currentIds?: string[];
  configureAdapters?: boolean;
}

function isInteractiveTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function canPromptForAdapters(): boolean {
  return isInteractiveTTY();
}

function getPromptInitialSelection(currentIds?: string[]): AdapterId[] {
  const current = sanitizeEnabledAdapterIds(currentIds ?? []);
  if (current.length > 0) return current;
  return getDefaultAdapterIds();
}

export async function promptForAdapterSelection(
  options: AdapterSelectionOptions = {},
): Promise<AdapterId[]> {
  if (!isInteractiveTTY()) {
    throw new Error('Cannot prompt for adapter selection without an interactive TTY.');
  }

  const catalog = getCatalog();
  const lockedIds = catalog.filter((entry) => entry.locked).map((entry) => entry.id);
  const initialValues = Array.from(
    new Set<AdapterId>([...lockedIds, ...getPromptInitialSelection(options.currentIds)]),
  );

  const promptOptions: { value: string; label: string; hint: string; disabled?: boolean }[] =
    catalog
      .sort((a, b) => {
        if (a.group !== b.group) return a.group === 'universal' ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      })
      .map((entry) => ({
        value: entry.id,
        label: entry.displayName,
        hint:
          entry.group === 'universal'
            ? entry.implemented
              ? 'universal'
              : 'universal, stub'
            : entry.implemented
              ? 'agent adapter'
              : 'agent adapter (stub)',
        disabled: Boolean(entry.locked),
      }));

  intro('planfig adapter setup');
  if (!options.configureAdapters) {
    console.log('[planfig] First run detected. Select adapters to enable:');
  } else {
    console.log('[planfig] Reconfiguring enabled adapters:');
  }

  const selected = await autocompleteMultiselect<string>({
    message: 'Which adapters do you want to enable?',
    options: promptOptions,
    initialValues,
    required: true,
    placeholder: 'Type to filter adapters...',
  });

  if (isCancel(selected)) {
    cancel('Adapter selection cancelled.');
    process.exit(1);
  }

  const sanitized = sanitizeEnabledAdapterIds(selected);
  if (sanitized.length === 0) {
    cancel('At least one adapter must be selected.');
    process.exit(1);
  }

  outro(`Selected ${sanitized.length} adapters.`);
  return sanitized;
}
