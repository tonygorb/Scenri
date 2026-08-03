import { useEffect, useState } from 'react';
import { api, type Product } from './api.js';

/** Live unified product library (manual + catalog) for a brand. */
export function useProductLibrary(brandId: string | undefined | null): Product[] {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!brandId) {
      setProducts([]);
      return;
    }
    let alive = true;
    const load = () => {
      void api
        .productsLibrary(brandId)
        .then((r) => {
          if (alive) setProducts(r.products);
        })
        .catch(() => {
          if (alive) setProducts([]);
        });
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [brandId]);

  return products;
}
