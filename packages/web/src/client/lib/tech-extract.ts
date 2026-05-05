import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';

export type TechCategory =
  | 'language'
  | 'runtime'
  | 'framework'
  | 'library'
  | 'tooling'
  | 'database'
  | 'cloud'
  | 'testing';

export interface TechEntry {
  canonical: string;
  aliases: string[];
  category: TechCategory;
  iconSlug?: string;
}

export interface DetectedTech {
  canonical: string;
  category: TechCategory;
  confidence: number;
  iconSlug?: string;
  sources: Array<{
    type: 'inline-code' | 'fenced-code' | 'heading' | 'paragraph' | 'link';
    text: string;
  }>;
  paragraphIndices: number[];
}

const TECH_DICTIONARY: TechEntry[] = [
  // Languages
  {
    canonical: 'TypeScript',
    aliases: ['typescript', 'ts'],
    category: 'language',
    iconSlug: 'typescript',
  },
  {
    canonical: 'JavaScript',
    aliases: ['javascript', 'js'],
    category: 'language',
    iconSlug: 'javascript',
  },
  { canonical: 'Python', aliases: ['python', 'py'], category: 'language', iconSlug: 'python' },
  { canonical: 'Rust', aliases: ['rust', 'rs'], category: 'language', iconSlug: 'rust' },
  { canonical: 'Go', aliases: ['go', 'golang'], category: 'language', iconSlug: 'go' },
  { canonical: 'Java', aliases: ['java'], category: 'language', iconSlug: 'java' },
  {
    canonical: 'C#',
    aliases: ['c#', 'csharp', 'c-sharp'],
    category: 'language',
    iconSlug: 'csharp',
  },
  { canonical: 'Ruby', aliases: ['ruby', 'rb'], category: 'language', iconSlug: 'ruby' },
  { canonical: 'PHP', aliases: ['php'], category: 'language', iconSlug: 'php' },
  { canonical: 'Swift', aliases: ['swift'], category: 'language', iconSlug: 'swift' },
  { canonical: 'Kotlin', aliases: ['kotlin', 'kt'], category: 'language', iconSlug: 'kotlin' },
  { canonical: 'SQL', aliases: ['sql'], category: 'language' },
  { canonical: 'HTML', aliases: ['html', 'html5'], category: 'language', iconSlug: 'html5' },
  { canonical: 'CSS', aliases: ['css', 'css3'], category: 'language', iconSlug: 'css3' },
  { canonical: 'Sass', aliases: ['sass', 'scss'], category: 'language', iconSlug: 'sass' },
  { canonical: 'Zig', aliases: ['zig'], category: 'language', iconSlug: 'zig' },
  {
    canonical: 'Elixir',
    aliases: ['elixir', 'ex', 'exs'],
    category: 'language',
    iconSlug: 'elixir',
  },
  { canonical: 'Dart', aliases: ['dart'], category: 'language', iconSlug: 'dart' },

  // Runtimes
  {
    canonical: 'Node.js',
    aliases: ['node', 'node.js', 'nodejs'],
    category: 'runtime',
    iconSlug: 'nodedotjs',
  },
  { canonical: 'Bun', aliases: ['bun'], category: 'runtime', iconSlug: 'bun' },
  { canonical: 'Deno', aliases: ['deno'], category: 'runtime', iconSlug: 'deno' },

  // Frameworks
  {
    canonical: 'React',
    aliases: ['react', 'reactjs', 'react.js'],
    category: 'framework',
    iconSlug: 'react',
  },
  {
    canonical: 'Vue',
    aliases: ['vue', 'vuejs', 'vue.js'],
    category: 'framework',
    iconSlug: 'vuedotjs',
  },
  {
    canonical: 'Angular',
    aliases: ['angular', 'angularjs'],
    category: 'framework',
    iconSlug: 'angular',
  },
  { canonical: 'Svelte', aliases: ['svelte'], category: 'framework', iconSlug: 'svelte' },
  {
    canonical: 'Next.js',
    aliases: ['next', 'next.js', 'nextjs'],
    category: 'framework',
    iconSlug: 'nextdotjs',
  },
  {
    canonical: 'Nuxt',
    aliases: ['nuxt', 'nuxt.js', 'nuxtjs'],
    category: 'framework',
    iconSlug: 'nuxtdotjs',
  },
  { canonical: 'Remix', aliases: ['remix'], category: 'framework', iconSlug: 'remix' },
  { canonical: 'Astro', aliases: ['astro'], category: 'framework', iconSlug: 'astro' },
  { canonical: 'SvelteKit', aliases: ['sveltekit'], category: 'framework', iconSlug: 'svelte' },
  {
    canonical: 'Express',
    aliases: ['express', 'expressjs', 'express.js'],
    category: 'framework',
    iconSlug: 'express',
  },
  { canonical: 'Hono', aliases: ['hono'], category: 'framework', iconSlug: 'hono' },
  { canonical: 'Fastify', aliases: ['fastify'], category: 'framework', iconSlug: 'fastify' },
  { canonical: 'NestJS', aliases: ['nestjs', 'nest'], category: 'framework', iconSlug: 'nestjs' },
  { canonical: 'Django', aliases: ['django'], category: 'framework', iconSlug: 'django' },
  { canonical: 'Flask', aliases: ['flask'], category: 'framework', iconSlug: 'flask' },
  { canonical: 'FastAPI', aliases: ['fastapi'], category: 'framework', iconSlug: 'fastapi' },
  {
    canonical: 'Rails',
    aliases: ['rails', 'ruby on rails', 'rubyonrails'],
    category: 'framework',
    iconSlug: 'rubyonrails',
  },
  {
    canonical: 'Spring Boot',
    aliases: ['spring boot', 'spring-boot', 'springboot', 'spring'],
    category: 'framework',
    iconSlug: 'springboot',
  },
  { canonical: '.NET', aliases: ['.net', 'dotnet'], category: 'framework', iconSlug: 'dotnet' },
  { canonical: 'Flutter', aliases: ['flutter'], category: 'framework', iconSlug: 'flutter' },
  {
    canonical: 'React Native',
    aliases: ['react native', 'react-native', 'reactnative'],
    category: 'framework',
    iconSlug: 'react',
  },
  {
    canonical: 'Electron',
    aliases: ['electron', 'electronjs'],
    category: 'framework',
    iconSlug: 'electron',
  },
  { canonical: 'Tauri', aliases: ['tauri'], category: 'framework', iconSlug: 'tauri' },

  // Libraries
  {
    canonical: 'Redux',
    aliases: ['redux', 'react-redux', '@reduxjs/toolkit'],
    category: 'library',
    iconSlug: 'redux',
  },
  { canonical: 'Zustand', aliases: ['zustand'], category: 'library' },
  {
    canonical: 'TanStack Query',
    aliases: ['tanstack query', '@tanstack/react-query', 'react-query', 'react query'],
    category: 'library',
    iconSlug: 'reactquery',
  },
  { canonical: 'Zod', aliases: ['zod'], category: 'library', iconSlug: 'zod' },
  {
    canonical: 'Prisma',
    aliases: ['prisma', '@prisma/client'],
    category: 'library',
    iconSlug: 'prisma',
  },
  {
    canonical: 'Drizzle',
    aliases: ['drizzle', 'drizzle-orm'],
    category: 'library',
    iconSlug: 'drizzle',
  },
  { canonical: 'tRPC', aliases: ['trpc', '@trpc/server', '@trpc/client'], category: 'library' },
  {
    canonical: 'Socket.IO',
    aliases: ['socket.io', 'socketio'],
    category: 'library',
    iconSlug: 'socketdotio',
  },
  { canonical: 'Axios', aliases: ['axios'], category: 'library', iconSlug: 'axios' },
  {
    canonical: 'Lodash',
    aliases: ['lodash', 'lodash-es'],
    category: 'library',
    iconSlug: 'lodash',
  },
  { canonical: 'date-fns', aliases: ['date-fns'], category: 'library' },
  {
    canonical: 'React Router',
    aliases: ['react-router', 'react-router-dom', 'react router'],
    category: 'library',
    iconSlug: 'reactrouter',
  },
  {
    canonical: 'Three.js',
    aliases: ['three', 'three.js', 'threejs'],
    category: 'library',
    iconSlug: 'threedotjs',
  },
  {
    canonical: 'D3.js',
    aliases: ['d3', 'd3.js', 'd3js'],
    category: 'library',
    iconSlug: 'd3dotjs',
  },

  // Tooling
  { canonical: 'Vite', aliases: ['vite', 'vitejs'], category: 'tooling', iconSlug: 'vite' },
  { canonical: 'Webpack', aliases: ['webpack'], category: 'tooling', iconSlug: 'webpack' },
  { canonical: 'esbuild', aliases: ['esbuild'], category: 'tooling', iconSlug: 'esbuild' },
  {
    canonical: 'Rollup',
    aliases: ['rollup', 'rollupjs'],
    category: 'tooling',
    iconSlug: 'rollupdotjs',
  },
  { canonical: 'Turbopack', aliases: ['turbopack'], category: 'tooling', iconSlug: 'turbopack' },
  {
    canonical: 'Tailwind CSS',
    aliases: ['tailwind', 'tailwindcss', 'tailwind css'],
    category: 'tooling',
    iconSlug: 'tailwindcss',
  },
  { canonical: 'PostCSS', aliases: ['postcss'], category: 'tooling', iconSlug: 'postcss' },
  { canonical: 'ESLint', aliases: ['eslint'], category: 'tooling', iconSlug: 'eslint' },
  { canonical: 'Prettier', aliases: ['prettier'], category: 'tooling', iconSlug: 'prettier' },
  { canonical: 'Oxfmt', aliases: ['oxfmt'], category: 'tooling' },
  { canonical: 'Oxlint', aliases: ['oxlint'], category: 'tooling' },
  { canonical: 'Biome', aliases: ['biome', 'biomejs'], category: 'tooling' },
  { canonical: 'Docker', aliases: ['docker'], category: 'tooling', iconSlug: 'docker' },
  {
    canonical: 'Kubernetes',
    aliases: ['kubernetes', 'k8s'],
    category: 'tooling',
    iconSlug: 'kubernetes',
  },
  { canonical: 'Terraform', aliases: ['terraform'], category: 'tooling', iconSlug: 'terraform' },
  { canonical: 'Git', aliases: ['git'], category: 'tooling', iconSlug: 'git' },
  {
    canonical: 'GitHub Actions',
    aliases: ['github actions', 'github-actions'],
    category: 'tooling',
    iconSlug: 'githubactions',
  },
  {
    canonical: 'Turborepo',
    aliases: ['turborepo', 'turbo'],
    category: 'tooling',
    iconSlug: 'turborepo',
  },
  { canonical: 'pnpm', aliases: ['pnpm'], category: 'tooling', iconSlug: 'pnpm' },
  { canonical: 'Vitest', aliases: ['vitest'], category: 'tooling', iconSlug: 'vitest' },

  // Databases
  {
    canonical: 'PostgreSQL',
    aliases: ['postgresql', 'postgres', 'pg'],
    category: 'database',
    iconSlug: 'postgresql',
  },
  { canonical: 'MySQL', aliases: ['mysql'], category: 'database', iconSlug: 'mysql' },
  { canonical: 'SQLite', aliases: ['sqlite', 'sqlite3'], category: 'database', iconSlug: 'sqlite' },
  {
    canonical: 'MongoDB',
    aliases: ['mongodb', 'mongo'],
    category: 'database',
    iconSlug: 'mongodb',
  },
  { canonical: 'Redis', aliases: ['redis'], category: 'database', iconSlug: 'redis' },
  {
    canonical: 'DynamoDB',
    aliases: ['dynamodb', 'dynamo'],
    category: 'database',
    iconSlug: 'amazondynamodb',
  },
  {
    canonical: 'Supabase',
    aliases: ['supabase', '@supabase/supabase-js'],
    category: 'database',
    iconSlug: 'supabase',
  },
  {
    canonical: 'PlanetScale',
    aliases: ['planetscale'],
    category: 'database',
    iconSlug: 'planetscale',
  },
  { canonical: 'Neon', aliases: ['neon', '@neondatabase/serverless'], category: 'database' },
  {
    canonical: 'CockroachDB',
    aliases: ['cockroachdb', 'cockroach'],
    category: 'database',
    iconSlug: 'cockroachlabs',
  },
  {
    canonical: 'Cassandra',
    aliases: ['cassandra'],
    category: 'database',
    iconSlug: 'apachecassandra',
  },
  {
    canonical: 'Elasticsearch',
    aliases: ['elasticsearch', 'elastic'],
    category: 'database',
    iconSlug: 'elasticsearch',
  },

  // Cloud
  {
    canonical: 'AWS',
    aliases: ['aws', 'amazon web services'],
    category: 'cloud',
    iconSlug: 'amazonaws',
  },
  {
    canonical: 'GCP',
    aliases: ['gcp', 'google cloud', 'google cloud platform'],
    category: 'cloud',
    iconSlug: 'googlecloud',
  },
  {
    canonical: 'Azure',
    aliases: ['azure', 'microsoft azure'],
    category: 'cloud',
    iconSlug: 'microsoftazure',
  },
  { canonical: 'Vercel', aliases: ['vercel'], category: 'cloud', iconSlug: 'vercel' },
  { canonical: 'Netlify', aliases: ['netlify'], category: 'cloud', iconSlug: 'netlify' },
  {
    canonical: 'Cloudflare',
    aliases: ['cloudflare', 'cf'],
    category: 'cloud',
    iconSlug: 'cloudflare',
  },
  { canonical: 'Convex', aliases: ['convex'], category: 'cloud', iconSlug: 'convex' },
  { canonical: 'Firebase', aliases: ['firebase'], category: 'cloud', iconSlug: 'firebase' },
  { canonical: 'Stripe', aliases: ['stripe'], category: 'cloud', iconSlug: 'stripe' },
  { canonical: 'Auth0', aliases: ['auth0'], category: 'cloud', iconSlug: 'auth0' },
  {
    canonical: 'Clerk',
    aliases: ['clerk', '@clerk/nextjs', '@clerk/clerk-react'],
    category: 'cloud',
    iconSlug: 'clerk',
  },

  // Testing
  { canonical: 'Jest', aliases: ['jest'], category: 'testing', iconSlug: 'jest' },
  { canonical: 'Vitest', aliases: ['vitest'], category: 'testing', iconSlug: 'vitest' },
  {
    canonical: 'Playwright',
    aliases: ['playwright', '@playwright/test'],
    category: 'testing',
    iconSlug: 'playwright',
  },
  { canonical: 'Cypress', aliases: ['cypress'], category: 'testing', iconSlug: 'cypress' },
  { canonical: 'Puppeteer', aliases: ['puppeteer'], category: 'testing', iconSlug: 'puppeteer' },
  {
    canonical: 'Testing Library',
    aliases: [
      'testing library',
      '@testing-library/react',
      '@testing-library/jest-dom',
      '@testing-library/dom',
    ],
    category: 'testing',
    iconSlug: 'testinglibrary',
  },
  { canonical: 'Mocha', aliases: ['mocha'], category: 'testing', iconSlug: 'mocha' },
  {
    canonical: 'Storybook',
    aliases: ['storybook', '@storybook/react'],
    category: 'testing',
    iconSlug: 'storybook',
  },
];

// Build lookup map: lowercase alias → TechEntry
const aliasMap = new Map<string, TechEntry>();
for (const entry of TECH_DICTIONARY) {
  for (const alias of entry.aliases) {
    aliasMap.set(alias.toLowerCase(), entry);
  }
}

// Build word-boundary regex map for prose matching
const wordBoundaryRegexMap = new Map<string, { regex: RegExp; entry: TechEntry }>();
for (const entry of TECH_DICTIONARY) {
  for (const alias of entry.aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi');
    wordBoundaryRegexMap.set(alias.toLowerCase(), { regex, entry });
  }
}

interface MdNode extends Node {
  type: string;
  value?: string;
  lang?: string;
  children?: MdNode[];
  url?: string;
}

type SourceType = DetectedTech['sources'][number]['type'];

interface RawDetection {
  entry: TechEntry;
  confidence: number;
  source: { type: SourceType; text: string };
  paragraphIndex: number;
}

function extractPackageNames(code: string): string[] {
  const pkgs: string[] = [];

  // import ... from "pkg"
  for (const m of code.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)) {
    if (m[1]) pkgs.push(normalizePackageName(m[1]));
  }

  // require("pkg")
  for (const m of code.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (m[1]) pkgs.push(normalizePackageName(m[1]));
  }

  // bun add / npm install / yarn add / pnpm add
  for (const m of code.matchAll(
    /(?:bun\s+add|npm\s+install|npm\s+i|yarn\s+add|pnpm\s+add)\s+(.+)/g,
  )) {
    const args = (m[1] ?? '').split(/\s+/);
    for (const arg of args) {
      const cleaned = arg.replace(/^-+\S*/, '').trim();
      if (cleaned && !cleaned.startsWith('-')) {
        pkgs.push(normalizePackageName(cleaned));
      }
    }
  }

  // package.json dependency blocks: "pkg": "^version"
  for (const m of code.matchAll(/"([^"]+)"\s*:\s*"[\^~>=<*]?[\d.]+[^"]*"/g)) {
    const name = m[1];
    if (name && !name.startsWith('//') && /^[@a-z]/.test(name)) {
      pkgs.push(name);
    }
  }

  return [...new Set(pkgs)];
}

function normalizePackageName(raw: string): string {
  const withoutVersion = raw.replace(/@[\^~>=<*]?[\d.]+.*$/, '');
  if (withoutVersion.startsWith('@')) {
    const [scope, name] = withoutVersion.split('/');
    return scope && name ? `${scope}/${name}` : withoutVersion;
  }
  return withoutVersion.replace(/\/.*$/, '');
}

function categorizeUnknownPackage(name: string): TechCategory {
  if (name.startsWith('@types/')) return 'tooling';
  if (/^eslint[-/]/.test(name) || /^prettier[-/]/.test(name)) return 'tooling';
  if (/^vite-plugin[-/]/.test(name) || /^rollup-plugin[-/]/.test(name)) return 'tooling';
  if (/^@aws-sdk\//.test(name)) return 'cloud';
  return 'library';
}

function matchExact(text: string): TechEntry | undefined {
  return aliasMap.get(text.toLowerCase());
}

function matchWordBoundary(text: string): Array<{ entry: TechEntry; matchedText: string }> {
  const results: Array<{ entry: TechEntry; matchedText: string }> = [];
  const seen = new Set<string>();

  for (const [, { regex, entry }] of wordBoundaryRegexMap) {
    regex.lastIndex = 0;
    const m = regex.exec(text);
    if (m && !seen.has(entry.canonical)) {
      seen.add(entry.canonical);
      results.push({ entry, matchedText: m[0] });
    }
  }

  return results;
}

export function extractTechnologies(markdown: string): DetectedTech[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  let paragraphIndex = 0;
  const detections: RawDetection[] = [];

  visit(tree, (node: Node) => {
    const mdNode = node as MdNode;

    switch (mdNode.type) {
      case 'heading': {
        processTextContent(mdNode, 'heading', 0.7, paragraphIndex, detections);
        paragraphIndex++;
        break;
      }
      case 'paragraph': {
        processTextContent(mdNode, 'paragraph', 0.5, paragraphIndex, detections);
        paragraphIndex++;
        break;
      }
      case 'listItem': {
        processTextContent(mdNode, 'paragraph', 0.5, paragraphIndex, detections);
        paragraphIndex++;
        break;
      }
      case 'inlineCode': {
        if (mdNode.value) {
          const entry = matchExact(mdNode.value);
          if (entry) {
            detections.push({
              entry,
              confidence: 0.8,
              source: { type: 'inline-code', text: mdNode.value },
              paragraphIndex,
            });
          }
        }
        break;
      }
      case 'code': {
        processFencedCode(mdNode, paragraphIndex, detections);
        paragraphIndex++;
        break;
      }
      case 'link': {
        if (mdNode.url) {
          const matches = matchWordBoundary(mdNode.url);
          for (const { entry, matchedText } of matches) {
            detections.push({
              entry,
              confidence: 0.6,
              source: { type: 'link', text: matchedText },
              paragraphIndex,
            });
          }
        }
        processTextContent(mdNode, 'link', 0.6, paragraphIndex, detections);
        break;
      }
    }
  });

  return deduplicateDetections(detections);
}

function collectText(node: MdNode): string {
  if (node.value) return node.value;
  if (node.children) {
    return node.children.map(collectText).join(' ');
  }
  return '';
}

function processTextContent(
  node: MdNode,
  sourceType: SourceType,
  confidence: number,
  paragraphIndex: number,
  detections: RawDetection[],
): void {
  const text = collectText(node);
  if (!text) return;

  // Also check inline code children directly
  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'inlineCode' && child.value) {
        const entry = matchExact(child.value);
        if (entry) {
          detections.push({
            entry,
            confidence: 0.8,
            source: { type: 'inline-code', text: child.value },
            paragraphIndex,
          });
        }
      }
    }
  }

  const matches = matchWordBoundary(text);
  for (const { entry, matchedText } of matches) {
    detections.push({
      entry,
      confidence,
      source: { type: sourceType, text: matchedText },
      paragraphIndex,
    });
  }
}

function processFencedCode(node: MdNode, paragraphIndex: number, detections: RawDetection[]): void {
  // Check lang attribute
  if (node.lang) {
    const entry = matchExact(node.lang);
    if (entry) {
      detections.push({
        entry,
        confidence: 0.9,
        source: { type: 'fenced-code', text: node.lang },
        paragraphIndex,
      });
    }
  }

  const code = node.value ?? '';
  if (!code) return;

  const pkgs = extractPackageNames(code);

  for (const pkg of pkgs) {
    const entry = matchExact(pkg);
    if (entry) {
      detections.push({
        entry,
        confidence: 1.0,
        source: { type: 'fenced-code', text: pkg },
        paragraphIndex,
      });
    } else {
      // Unknown package — infer category
      const category = categorizeUnknownPackage(pkg);
      detections.push({
        entry: {
          canonical: pkg,
          aliases: [pkg.toLowerCase()],
          category,
        },
        confidence: 1.0,
        source: { type: 'fenced-code', text: pkg },
        paragraphIndex,
      });
    }
  }
}

function deduplicateDetections(detections: RawDetection[]): DetectedTech[] {
  const map = new Map<string, DetectedTech>();

  for (const d of detections) {
    const key = d.entry.canonical;
    const existing = map.get(key);

    if (existing) {
      if (d.confidence > existing.confidence) {
        existing.confidence = d.confidence;
      }
      const sourceKey = `${d.source.type}:${d.source.text}`;
      const alreadyHasSource = existing.sources.some((s) => `${s.type}:${s.text}` === sourceKey);
      if (!alreadyHasSource) {
        existing.sources.push(d.source);
      }
      if (!existing.paragraphIndices.includes(d.paragraphIndex)) {
        existing.paragraphIndices.push(d.paragraphIndex);
      }
    } else {
      map.set(key, {
        canonical: d.entry.canonical,
        category: d.entry.category,
        confidence: d.confidence,
        iconSlug: d.entry.iconSlug,
        sources: [d.source],
        paragraphIndices: [d.paragraphIndex],
      });
    }
  }

  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}
