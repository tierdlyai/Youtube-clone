import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync(), 2000);
    return () => clearTimeout(t);
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}