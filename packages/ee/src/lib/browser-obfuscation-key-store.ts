import { utf8 } from '@agendex/shared/crypto';

const DB_NAME = 'agendex-obfuscation';
const STORE_NAME = 'workspace-keys';
const DB_VERSION = 1;

type StoredWorkspaceKey = {
  id: string;
  deviceKey: CryptoKey;
  nonce: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function scope(workspaceOwnerId: string, keyEpoch: number): string {
  return `${workspaceOwnerId}:epoch:${keyEpoch}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open browser key store'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser key store failed'));
  });
}

export async function storeBrowserWorkspaceKey(
  workspaceOwnerId: string,
  keyEpoch: number,
  workspaceKey: Uint8Array,
): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return false;
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const id = scope(workspaceOwnerId, keyEpoch);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(utf8(id)) },
    deviceKey,
    toArrayBuffer(workspaceKey),
  );
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({ id, deviceKey, nonce: toArrayBuffer(nonce), ciphertext }),
    );
    return true;
  } finally {
    database.close();
  }
}

export async function loadBrowserWorkspaceKey(
  workspaceOwnerId: string,
  keyEpoch: number,
): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return null;
  const id = scope(workspaceOwnerId, keyEpoch);
  const database = await openDatabase();
  try {
    const record = (await requestResult(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id),
    )) as StoredWorkspaceKey | undefined;
    if (!record) return null;
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.nonce, additionalData: toArrayBuffer(utf8(id)) },
        record.deviceKey,
        record.ciphertext,
      ),
    );
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function clearBrowserWorkspaceKey(
  workspaceOwnerId: string,
  keyEpoch: number,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .delete(scope(workspaceOwnerId, keyEpoch)),
    );
  } finally {
    database.close();
  }
}

export async function clearAllBrowserWorkspaceKeys(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to clear browser key store'));
    request.onblocked = () => reject(new Error('Browser key store is busy'));
  });
}
