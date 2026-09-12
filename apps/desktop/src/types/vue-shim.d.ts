// Fallback typing for `.vue` imports in tools that do not run Vue's
// TypeScript plugin (vue-tsc resolves the real SFC types and ignores this).
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}
