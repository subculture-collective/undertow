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
  if (dbp) return dbp;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    let blocked = false;
    req.onupgradeneeded = () => {
      for (const name of ['assets', 'projects'] as const) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Opened after giving up on a blocked open: nobody is waiting for this connection.
      if (blocked) { db.close(); return; }
      // A newer version opening in another tab waits for this connection; let it go and reopen next time.
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // An older tab still holds the database. Fail instead of waiting forever, which would hold up every later save.
    req.onblocked = () => { blocked = true; reject(new Error('Storage is in use by another Undertow tab. Close other tabs and try again.')); };
  });
  // A failed open is retried on the next call rather than cached.
  opening.catch(() => { if (dbp === opening) dbp = null; });
  dbp = opening;
  return opening;
}

/** Runs one request. Resolves once the transaction commits, so "saved" means the data is on disk. */
export async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    // Quota errors abort the whole transaction after the request itself succeeded.
    t.onabort = () => reject(t.error ?? req.error ?? new Error('Storage write was cancelled.'));
    t.onerror = () => reject(t.error ?? req.error);
  });
}
