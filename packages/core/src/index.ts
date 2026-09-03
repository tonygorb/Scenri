import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.js';
import { createImageStore, type ImageStore } from './imageStore.js';
import { createLedger, type Ledger } from './ledger.js';
import { createStore, type Store } from './store.js';
import { createCatalogStore, type CatalogStore } from './catalogStore.js';

export * from './engine.js';
export * from './store.js';
export * from './catalogStore.js';
export * from './searchRules.js';
export { SpendCapError, type Ledger } from './ledger.js';
export { SCHEMA_VERSION, SchemaTooNewError } from './db.js';
export type { ImageStore } from './imageStore.js';

export interface Core {
  home: string;
  store: Store;
  catalog: CatalogStore;
  images: ImageStore;
  ledger: Ledger;
  close(): void;
}

export function defaultHome(): string {
  return process.env.SCENRI_HOME || join(homedir(), '.scenri');
}

export function createCore(homeDir = defaultHome()): Core {
  const db = openDb(homeDir);
  return {
    home: homeDir,
    store: createStore(db),
    catalog: createCatalogStore(db),
    images: createImageStore(homeDir),
    ledger: createLedger(db),
    close: () => db.close(),
  };
}
