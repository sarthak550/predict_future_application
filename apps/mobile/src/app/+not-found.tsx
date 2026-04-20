import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Screen not found</Text>
      <Link href="/" style={styles.link}>
        Back to the feed
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0F172A"
  },
  link: {
    marginTop: 12,
    color: "#2563EB",
    fontSize: 16
  }
});
