/**
 * The shot settings family: the pills row, the phone sheet, and the plain
 * fields, sharing one prop language. Split by surface into ./shotSettings/;
 * this path stays the single import point (see Composer).
 */
export type { QualityId, ShotSettingsProps } from './shotSettings/settings.js';
export { RESOLUTIONS, VARIANTS, openOnGroup } from './shotSettings/settings.js';
export { ShotSettingsPills } from './shotSettings/ShotSettingsPills.js';
export { ShotSettings } from './shotSettings/ShotSettingsSheet.js';
export { ShotSettingsFields } from './shotSettings/ShotSettingsFields.js';
