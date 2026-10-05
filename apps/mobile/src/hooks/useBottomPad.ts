import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "@/lib/theme";

/**
 * Bottom padding for a scrolling screen that is not inside the tab bar. Android draws
 * edge-to-edge, so the system navigation bar overlaps the last row unless we add its height.
 */
export function useBottomPad(extra = spacing(4)): number {
  // The Screen container applies the inset (edges={["bottom"]}); content keeps ordinary padding.
  // Kept as a hook so screens can still react if the container ever stops doing that.
  useSafeAreaInsets();
  return extra;
}
