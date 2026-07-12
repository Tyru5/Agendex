import { CURRENT_CONFIG_VERSION, updateConfig } from '../src/config.ts';

const field = process.argv[2];
const delayMs = Number(process.argv[3] ?? 100);
if (field !== 'device' && field !== 'ip') process.exit(2);

updateConfig((current) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  return {
    ...(current ?? {
      configVersion: CURRENT_CONFIG_VERSION,
      enabledAdapters: [],
      customPlanDirs: [],
    }),
    ...(field === 'device' ? { deviceId: 'concurrent-device' } : {}),
    ...(field === 'ip' ? { collectLocalIpAddress: true } : {}),
  };
});
