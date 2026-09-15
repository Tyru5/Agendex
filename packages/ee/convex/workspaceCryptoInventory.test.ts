import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WORKSPACE_CRYPTO_INVENTORY,
  classifiedFields,
  type WorkspaceCryptoInventoryTable,
} from './workspaceCryptoInventory.ts';

function schemaFields(): Map<string, string[]> {
  const source = readFileSync(join(import.meta.dir, 'schema.ts'), 'utf8');
  const tables = new Map<string, string[]>();
  let current: string | null = null;
  let depth = 0;

  for (const line of source.split(/\r?\n/)) {
    const start = line.match(/^  (\w+): defineTable\(\{/);
    if (start?.[1]) {
      current = start[1];
      tables.set(current, []);
      depth = 1;
      continue;
    }
    if (!current) continue;
    if (depth === 1) {
      const field = line.match(/^    (\w+): /)?.[1];
      if (field) tables.get(current)?.push(field);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth <= 0 || line.startsWith('  })')) {
      current = null;
      depth = 0;
    }
  }
  return tables;
}

test('every workspace-owned schema field has exactly one crypto classification', () => {
  const fieldsByTable = schemaFields();
  expect([...fieldsByTable.keys()].sort()).toEqual(Object.keys(WORKSPACE_CRYPTO_INVENTORY).sort());

  for (const [tableName, schemaTableFields] of fieldsByTable) {
    const classified = classifiedFields(tableName as WorkspaceCryptoInventoryTable);
    expect([...new Set(classified)].sort()).toEqual([...classified].sort());
    expect(classified.sort()).toEqual(schemaTableFields.sort());
  }
});
