/// <reference types="vite/client" />

/** 仅 serve 与 `vite build --mode full` 为 true。 */
declare const __COTTAGE_INCLUDE_HIDDEN_FEATURES__: boolean;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
