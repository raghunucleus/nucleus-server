import { ATTRIBUTE_FETCHERS } from './attribute-fetchers';
import { ATTRIBUTE_TYPES } from './attribute-types';
import { MODULES } from './modules';
import { ROLE_TYPES } from './role-types';
import { SCREENS } from './screens';
import type { Catalog } from './types';

export { ATTRIBUTE_FETCHERS };
export type { AttributeFetcher, PickerOption } from './attribute-fetchers';

/** The full static RBAC catalog assembled from the per-concern arrays. */
export const CATALOG: Catalog = {
  modules: MODULES,
  role_types: ROLE_TYPES,
  attribute_types: ATTRIBUTE_TYPES,
  screens: SCREENS,
};

export {
  ATTRIBUTE_TYPES,
  MODULES,
  ROLE_TYPES,
  SCREENS,
};
export * from './types';
