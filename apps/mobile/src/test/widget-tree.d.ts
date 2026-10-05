/** Test-only: the widget library's JSX-to-tree builder (aliased in vitest.config.ts). */
declare module "react-native-android-widget-tree" {
  export function buildWidgetTree(element: unknown): unknown;
}
