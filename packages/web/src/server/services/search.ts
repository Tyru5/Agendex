import type { Plan } from '@agendex/shared';
import Fuse from 'fuse.js';

const fuse = new Fuse<Plan>([], {
  keys: [
    { name: 'title', weight: 2 },
    { name: 'content', weight: 1 },
    { name: 'agent', weight: 0.5 },
    { name: 'workspace', weight: 0.5 },
  ],
  threshold: 0.3,
  includeMatches: true,
});

export function rebuildIndex(plans: Plan[]) {
  fuse.setCollection(plans);
}

export function search(query: string): Plan[] {
  return fuse.search(query).map((r) => r.item);
}
