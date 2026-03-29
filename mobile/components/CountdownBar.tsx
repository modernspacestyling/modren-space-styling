import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';

interface Props {
  endDate: string;
  totalDays?: number;
}

export default function CountdownBar({ endDate, totalDays = 42 }: Props) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((end.getTime() - now.getTime()) / 86400000);
  const pct = Math.max(0, Math.min(100, Math.round((daysLeft / totalDays) * 100)));

  let barColor = Colors.success;
  let label = `${daysLeft} days remaining`;
  if (daysLeft <= 0) {
    barColor = Colors.danger;
    label = daysLeft === 0 ? 'Ends today!' : 'Overdue';
  } else if (daysLeft <= 5) {
    barColor = Colors.danger;
  } else if (daysLeft <= 14) {
    barColor = Colors.warning;
  }

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.date}>
          {end.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  date: { fontSize: 11, color: Colors.textMuted },
  track: { height: 6, backgroundColor: Colors.sandLight, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
