import { StyleSheet, Text, View } from "react-native";

interface PlaceholderScreenProps {
  title: string;
}

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "700",
  },
});
