/**
 * The catalog store: one object over sqlite, composed from the method groups
 * in ./catalog/. Types and row mappers live in ./catalog/rows.ts and are
 * re-exported here, so `@scenri/core`'s public surface is unchanged.
 */
import type { DB } from './db.js';
import { sourceMethods } from './catalog/sources.js';
import { jobMethods } from './catalog/jobs.js';
import { productImportMethods } from './catalog/productImport.js';
import { readMethods } from './catalog/reads.js';
import { mutationMethods } from './catalog/mutations.js';
import { libraryMethods } from './catalog/library.js';

export type {
  CatalogImageRow,
  CatalogPlatform,
  CatalogProductRow,
  CatalogSourceRow,
  CatalogVariantRow,
  ImportJobRow,
  ImportStage,
  LibraryProduct,
} from './catalog/rows.js';

export function createCatalogStore(db: DB) {
  return {
    ...sourceMethods(db),
    ...jobMethods(db),
    ...productImportMethods(db),
    ...readMethods(db),
    ...mutationMethods(db),
    ...libraryMethods(db),
  };
}

export type CatalogStore = ReturnType<typeof createCatalogStore>;
