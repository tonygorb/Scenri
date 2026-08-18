import type { DB } from '../db.js';
import {
  imagesFor,
  productById,
  productsFor,
  variantsFor,
  type CatalogImageRow,
  type CatalogProductRow,
  type CatalogVariantRow,
} from './rows.js';

export function readMethods(db: DB) {
  return {
    getProduct(id: string): CatalogProductRow | null {
      return productById(db, id);
    },

    getProductByLibraryId(libraryId: string): CatalogProductRow | null {
      if (!libraryId.startsWith('cat-')) return null;
      return productById(db, libraryId.slice(4));
    },

    listProducts(brandId: string): CatalogProductRow[] {
      return productsFor(db, brandId);
    },

    listVariants(productId: string): CatalogVariantRow[] {
      return variantsFor(db, productId);
    },

    listImages(productId: string): CatalogImageRow[] {
      return imagesFor(db, productId);
    },
  };
}
