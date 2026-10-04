export interface ImpactRule {
  area: string;
  prefixes: string[];
}

export interface ImpactHit {
  area: string;
  files: string[];
}

export function parseMap(markdown: string): ImpactRule[];
export function areasFor(files: string[], rules: ImpactRule[]): ImpactHit[];
