// Speicher im Browser (IndexedDB): Sound-Bibliothek und Einstellungen. Die Daten bleiben auf dem Gerät.

const DB_NAME = "drumpad";
const DB_VERSION = 1;
let opened = null;

function open() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sounds", { keyPath: "name" });
      request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

async function run(storeName, mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const putSound = (record) => run("sounds", "readwrite", (store) => store.put(record));
export const getSound = (name) => run("sounds", "readonly", (store) => store.get(name));
export const deleteSound = (name) => run("sounds", "readwrite", (store) => store.delete(name));
export const listSounds = () => run("sounds", "readonly", (store) => store.getAll());

export const getKV = (key) => run("kv", "readonly", (store) => store.get(key));
export const setKV = (key, value) => run("kv", "readwrite", (store) => store.put(value, key));
export const deleteKV = (key) => run("kv", "readwrite", (store) => store.delete(key));
export const listKVKeys = () => run("kv", "readonly", (store) => store.getAllKeys());
