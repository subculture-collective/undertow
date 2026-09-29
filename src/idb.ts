/**
 * The editor's IndexedDB database. `assets` holds uploaded files; `projects`
 * holds projects saved in this browser. The name predates the Undertow rename
 * and stays so existing libraries keep working.
 */
const DB = 'vizstudio';
const VERSION = 2;
export type StoreName = 'assets' | 'projects';

let dbp: Promise<IDBDatabase> | null = null;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      for (const name of ['assets', 'projects'] as const) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
