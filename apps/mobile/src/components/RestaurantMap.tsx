// Metro resolves name.web.tsx (web) / name.native.tsx (iOS, Android) before name.tsx, so this
// plain file only gives TypeScript (which ignores platform extensions) something to resolve.
export { RestaurantMap } from "./RestaurantMap.native";
export type { RestaurantMapProps } from "./RestaurantMap.native";
