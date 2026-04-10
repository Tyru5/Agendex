import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import { useEffect, useMemo, useState } from 'react';
import supportedLanguagesTable from '../../../node_modules/highlight.js/SUPPORTED_LANGUAGES.md?raw';
import { MermaidDiagram } from './MermaidDiagram.tsx';

type LanguageModule = {
  default: LanguageFn;
};

const rawLanguageLoaders = import.meta.glob<LanguageModule>(
  '../../../node_modules/highlight.js/lib/languages/*.js.js',
);
const languageLoaders = buildLanguageLoaders(rawLanguageLoaders);
const languageAliases = buildLanguageAliases(
  supportedLanguagesTable,
  new Set(Object.keys(languageLoaders)),
);
const languageLoadPromises = new Map<string, Promise<void>>();
const AUTO_DETECT_LANGUAGE_PRIMERS = [
  'bash',
  'javascript',
  'typescript',
  'python',
  'json',
  'yaml',
  'markdown',
  'sql',
  'xml',
  'css',
];
let autoDetectPrimerPromise: Promise<void> | undefined;

function buildLanguageLoaders(
  loaders: Record<string, () => Promise<LanguageModule>>,
): Record<string, () => Promise<LanguageModule>> {
  const mapped: Record<string, () => Promise<LanguageModule>> = {};

  for (const [modulePath, loader] of Object.entries(loaders)) {
    const fileName = modulePath.split('/').pop();
    if (!fileName) continue;

    const moduleName = fileName.replace(/\.js$/, '').replace(/\.js$/, '');
    if (moduleName in mapped) continue;
    mapped[moduleName] = loader;
  }

  return mapped;
}

function normalizeLanguageLabel(language: string): string {
  return language
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^lang-/, '')
    .replace(/^\{\.?/, '')
    .replace(/\}$/, '');
}

function buildLanguageAliases(
  markdownTable: string,
  availableModules: Set<string>,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  const lines = markdownTable.split('\n');

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes(':-----------------------')) continue;

    const columns = line.split('|').map((column) => column.trim());
    const aliasesCell = columns[2];
    if (!aliasesCell || aliasesCell.toLowerCase() === 'aliases') continue;

    const parsedAliases = aliasesCell
      .split(',')
      .map((alias) => normalizeLanguageLabel(alias))
      .filter(Boolean);
    if (parsedAliases.length === 0) continue;

    const moduleName = parsedAliases.find((alias) => availableModules.has(alias));
    if (!moduleName) continue;

    for (const alias of parsedAliases) {
      aliases[alias] = moduleName;
    }
  }

  aliases['c#'] = 'csharp';
  aliases['f#'] = 'fsharp';
  aliases['obj-c'] = 'objectivec';
  aliases['obj-c++'] = 'objectivec';

  return aliases;
}

function isMermaidLanguage(language?: string): boolean {
  if (!language) return false;
  return normalizeLanguageLabel(language) === 'mermaid';
}

function resolveLanguageName(language?: string): string | undefined {
  if (!language) return undefined;
  const normalized = normalizeLanguageLabel(language);
  if (!normalized) return undefined;

  if (languageLoaders[normalized]) return normalized;
  if (languageAliases[normalized]) return languageAliases[normalized];
  if (languageLoaders[normalized.replace(/_/g, '-')]) return normalized.replace(/_/g, '-');

  return undefined;
}

async function ensureLanguageLoaded(language?: string): Promise<string | undefined> {
  const resolvedLanguage = resolveLanguageName(language);
  if (!resolvedLanguage) return undefined;
  if (hljs.getLanguage(resolvedLanguage)) return resolvedLanguage;

  const loader = languageLoaders[resolvedLanguage];
  if (!loader) return undefined;

  let pending = languageLoadPromises.get(resolvedLanguage);
  if (!pending) {
    pending = loader()
      .then((module) => {
        hljs.registerLanguage(resolvedLanguage, module.default);
      })
      .catch(() => {})
      .finally(() => {
        languageLoadPromises.delete(resolvedLanguage);
      });

    languageLoadPromises.set(resolvedLanguage, pending);
  }

  await pending;
  return hljs.getLanguage(resolvedLanguage) ? resolvedLanguage : undefined;
}

async function ensureAutoDetectPrimerLoaded(): Promise<void> {
  if (autoDetectPrimerPromise) {
    await autoDetectPrimerPromise;
    return;
  }

  autoDetectPrimerPromise = Promise.all(
    AUTO_DETECT_LANGUAGE_PRIMERS.map((language) => ensureLanguageLoaded(language)),
  ).then(() => {});

  await autoDetectPrimerPromise;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function highlightCode(
  code: string,
  language?: string,
): Promise<{ html: string; language?: string }> {
  const normalizedCode = code.replace(/\n$/, '');
  const loadedLanguage = await ensureLanguageLoaded(language);

  try {
    if (loadedLanguage) {
      return {
        html: hljs.highlight(normalizedCode, {
          language: loadedLanguage,
          ignoreIllegals: true,
        }).value,
        language: loadedLanguage,
      };
    }

    const registeredLanguages = hljs.listLanguages();
    if (registeredLanguages.length === 0) {
      await ensureAutoDetectPrimerLoaded();
    }

    const detectionLanguages = hljs.listLanguages();
    if (detectionLanguages.length > 0) {
      const auto = hljs.highlightAuto(normalizedCode, detectionLanguages);
      return {
        html: auto.value,
        language: auto.language,
      };
    }

    return {
      html: escapeHtml(normalizedCode),
    };
  } catch {
    return {
      html: escapeHtml(normalizedCode),
      language: loadedLanguage,
    };
  }
}

export function MarkdownCodeBlock({
  code,
  className,
  language,
}: {
  code: string;
  className?: string;
  language?: string;
}) {
  const isMermaid = isMermaidLanguage(language);
  const plainHtml = useMemo(() => escapeHtml(code), [code]);
  const [highlightedHtml, setHighlightedHtml] = useState(plainHtml);
  const [resolvedLanguage, setResolvedLanguage] = useState<string | undefined>(() =>
    isMermaid ? undefined : resolveLanguageName(language),
  );

  useEffect(() => {
    if (isMermaid) return;

    let cancelled = false;

    async function run() {
      const highlighted = await highlightCode(code, language);
      if (cancelled) return;
      setHighlightedHtml(highlighted.html);
      setResolvedLanguage(highlighted.language);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [code, language, isMermaid]);

  if (isMermaid) {
    return <MermaidDiagram className={className} code={code} />;
  }

  const mergedClassName = [
    className,
    'hljs',
    resolvedLanguage ? `language-${resolvedLanguage}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  // biome-ignore lint/security/noDangerouslySetInnerHtml: syntax-highlighted HTML from highlight.js
  return <code className={mergedClassName} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />;
}
