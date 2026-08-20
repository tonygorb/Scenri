// SPDX-License-Identifier: Apache-2.0
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
// Imported rather than read from disk: this module gets bundled into the Scenri
// CLI, where a path relative to import.meta.url would resolve inside that
// package and the schema file is not shipped there. Importing it makes the
// schema part of the module graph, so every consumer gets it for free.
import schema from '../schema/brand.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats.default ? addFormats.default(ajv) : (addFormats as any)(ajv);
const compiled = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBrand(json: unknown): ValidationResult {
  const valid = compiled(json) as boolean;
  return {
    valid,
    errors: valid ? [] : (compiled.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`),
  };
}
