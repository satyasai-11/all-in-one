const DATABASE_NAME = 'all-in-one-mobile';
const DATABASE_VERSION = 1;
const STORE_NAME = 'app-records';
const MAIN_KEY = 'primary';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open on-device storage.'));
    request.onblocked = () => reject(new Error('Close other All In One tabs, then reload this app.'));
  });
}

export async function readDeviceRecords<T>(): Promise<T | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(MAIN_KEY);
      request.onsuccess = () => resolve((request.result?.value as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read on-device records.'));
    });
  } finally { database.close(); }
}

export async function writeDeviceRecords<T>(value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ key: MAIN_KEY, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save on-device records.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving records was interrupted.'));
    });
  } finally { database.close(); }
}
