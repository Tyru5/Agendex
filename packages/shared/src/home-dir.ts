import { homedir } from 'node:os';

/**
 * Agent/plan root home. Prefer AGENDEX_HOME so desktop can re-root discovery
 * (e.g. WSL) without rewriting USERPROFILE or Electron paths.
 *
 * Kept outside config.ts so adapters can import it without a
 * catalog → config → registry → catalog cycle.
 */
export function getHomeDir(): string {
  const agendexHome = process.env.AGENDEX_HOME?.trim();
  if (agendexHome) return agendexHome;
  if (process.env.HOME) return process.env.HOME;
  if (process.env.USERPROFILE) return process.env.USERPROFILE;
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`;
  }
  return homedir();
}
