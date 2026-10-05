/**
 * App entry. expo-router renders the app; on Android the home screen widgets also need a
 * headless task handler registered at bundle load, before any screen mounts.
 */
import "expo-router/entry";
import { Platform } from "react-native";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widgets/taskHandler";

if (Platform.OS === "android") registerWidgetTaskHandler(widgetTaskHandler);
