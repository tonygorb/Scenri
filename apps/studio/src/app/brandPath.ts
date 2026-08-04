import type { Brand } from '../api.js';

/**
 * The brand's place in the address bar. The slug is the URL, the id is the key:
 * links read as /b/acme-coffee while every fetch and every stored preference
 * still goes by id, so renaming a brand cannot orphan its work.
 */
export const brandPath = (b: Brand, rest = ''): string => `/b/${b.slug}${rest}`;
