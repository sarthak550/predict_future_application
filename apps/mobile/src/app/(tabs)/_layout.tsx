import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#0F172A",
        tabBarInactiveTintColor: "#64748B",
        tabBarStyle: {
          height: 72,
          paddingTop: 8,
          paddingBottom: 10
        }
      }}
    >
      <Tabs.Screen name="feed" options={{ title: "Feed" }} />
      <Tabs.Screen name="markets" options={{ title: "Markets" }} />
      <Tabs.Screen name="create" options={{ title: "Create" }} />
      <Tabs.Screen name="groups" options={{ title: "Groups" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
