import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ATTRIBUTE_FETCHERS, CATALOG } from './catalog';
import type {
  AttributeTypeDef,
  Catalog,
  ModuleDef,
  RoleTypeDef,
  ScreenDef,
} from './catalog';

/**
 * Read-only accessor over the static RBAC catalog. Validates cross-references
 * at boot — a misconfigured catalog (unknown module_key, unknown role type,
 * unknown attribute type) fails server start rather than failing silently at
 * permission-check time.
 */
@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);

  private readonly moduleByKey = new Map<string, ModuleDef>();
  private readonly roleTypeByKey = new Map<string, RoleTypeDef>();
  private readonly attributeTypeByKey = new Map<string, AttributeTypeDef>();
  private readonly screenByKey = new Map<string, ScreenDef>();
  private readonly screensByRoleType = new Map<string, ScreenDef[]>();

  constructor() {
    for (const m of CATALOG.modules) this.moduleByKey.set(m.key, m);
    for (const rt of CATALOG.role_types) this.roleTypeByKey.set(rt.key, rt);
    for (const at of CATALOG.attribute_types) {
      this.attributeTypeByKey.set(at.key, at);
    }
    for (const s of CATALOG.screens) {
      this.screenByKey.set(s.key, s);
      for (const rtKey of s.role_type_keys) {
        const list = this.screensByRoleType.get(rtKey) ?? [];
        list.push(s);
        this.screensByRoleType.set(rtKey, list);
      }
    }
  }

  onModuleInit(): void {
    this.validate();
    this.logger.log(
      `RBAC catalog loaded: ${CATALOG.modules.length} modules, ` +
        `${CATALOG.role_types.length} role types, ` +
        `${CATALOG.attribute_types.length} attribute types, ` +
        `${CATALOG.screens.length} screens`,
    );
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getCatalog(): Catalog {
    return CATALOG;
  }

  getModules(): ReadonlyArray<ModuleDef> {
    return CATALOG.modules;
  }

  getRoleTypes(): ReadonlyArray<RoleTypeDef> {
    return CATALOG.role_types;
  }

  getAttributeTypes(): ReadonlyArray<AttributeTypeDef> {
    return CATALOG.attribute_types;
  }

  getScreens(): ReadonlyArray<ScreenDef> {
    return CATALOG.screens;
  }

  getModule(key: string): ModuleDef | undefined {
    return this.moduleByKey.get(key);
  }

  getRoleType(key: string): RoleTypeDef | undefined {
    return this.roleTypeByKey.get(key);
  }

  getAttributeType(key: string): AttributeTypeDef | undefined {
    return this.attributeTypeByKey.get(key);
  }

  getScreen(key: string): ScreenDef | undefined {
    return this.screenByKey.get(key);
  }

  getScreenOrThrow(key: string): ScreenDef {
    const s = this.screenByKey.get(key);
    if (!s) {
      throw new Error(`Unknown RBAC screen key: ${key}`);
    }
    return s;
  }

  /** Screens that can be selected when the role includes this role type. */
  getScreensForRoleType(roleTypeKey: string): ReadonlyArray<ScreenDef> {
    return this.screensByRoleType.get(roleTypeKey) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Validation (fail-fast at boot)
  // ---------------------------------------------------------------------------

  private validate(): void {
    const errors: string[] = [];

    if (
      this.moduleByKey.size !== CATALOG.modules.length ||
      this.roleTypeByKey.size !== CATALOG.role_types.length ||
      this.attributeTypeByKey.size !== CATALOG.attribute_types.length ||
      this.screenByKey.size !== CATALOG.screens.length
    ) {
      errors.push(
        'Duplicate keys detected in catalog. Modules / role types / attribute types / screens must each be unique.',
      );
    }

    // Every attribute type must have a matching fetcher, and vice versa.
    for (const attrType of CATALOG.attribute_types) {
      if (!ATTRIBUTE_FETCHERS[attrType.key]) {
        errors.push(
          `Attribute type "${attrType.key}" has no fetcher in attribute-fetchers.ts`,
        );
      }
    }
    for (const fetcherKey of Object.keys(ATTRIBUTE_FETCHERS)) {
      if (!this.attributeTypeByKey.has(fetcherKey)) {
        errors.push(
          `Fetcher "${fetcherKey}" has no matching AttributeTypeDef in attribute-types.ts`,
        );
      }
    }

    for (const screen of CATALOG.screens) {
      if (!this.moduleByKey.has(screen.module_key)) {
        errors.push(
          `Screen "${screen.key}" references unknown module_key "${screen.module_key}"`,
        );
      }
      if (screen.role_type_keys.length === 0) {
        errors.push(
          `Screen "${screen.key}" must list at least one role_type_key`,
        );
      }
      for (const rt of screen.role_type_keys) {
        if (!this.roleTypeByKey.has(rt)) {
          errors.push(
            `Screen "${screen.key}" references unknown role type "${rt}"`,
          );
        }
      }
      if (screen.platforms.length === 0) {
        errors.push(`Screen "${screen.key}" must declare at least one platform`);
      }
      if (
        screen.platforms.some((p) => p === 'web') &&
        !screen.web_route
      ) {
        errors.push(
          `Screen "${screen.key}" lists "web" but has no web_route`,
        );
      }
      if (
        screen.platforms.some((p) => p === 'mobile') &&
        !screen.mobile_route
      ) {
        errors.push(
          `Screen "${screen.key}" lists "mobile" but has no mobile_route`,
        );
      }
      const seenAttrKeys = new Set<string>();
      for (const attr of screen.attributes) {
        if (seenAttrKeys.has(attr.key)) {
          errors.push(
            `Screen "${screen.key}" has duplicate attribute "${attr.key}"`,
          );
        }
        seenAttrKeys.add(attr.key);
        if (!this.attributeTypeByKey.has(attr.type)) {
          errors.push(
            `Screen "${screen.key}" attribute "${attr.key}" references unknown type "${attr.type}"`,
          );
        }
      }
      const seenActions = new Set<string>();
      for (const a of screen.actions) {
        if (seenActions.has(a)) {
          errors.push(
            `Screen "${screen.key}" has duplicate action "${a}"`,
          );
        }
        seenActions.add(a);
      }
      if (screen.actions.length === 0) {
        errors.push(
          `Screen "${screen.key}" must declare at least one action`,
        );
      }
    }

    if (errors.length > 0) {
      const message =
        'RBAC catalog validation failed:\n  - ' + errors.join('\n  - ');
      this.logger.error(message);
      throw new Error(message);
    }
  }
}
