import "i18next";
import type { resources } from "./resources";

/**
 * Copy strings carry the brand as the `{{product}}` placeholder, filled at
 * translation time from the i18n default variables (`app/src/brand.ts`). Because
 * that variable is supplied globally, per-key interpolation types would demand it
 * at every `t()` call site. Widening the resource values to `string` keeps key
 * completion and namespace checking while letting the global variable pass.
 */
type RelaxedCopy<T> = {
  [K in keyof T]: T[K] extends string ? string : RelaxedCopy<T[K]>;
};

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: RelaxedCopy<(typeof resources)["en-US"]>;
  }
}
