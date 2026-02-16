import { createHash } from 'crypto';

export function hashPath(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}
