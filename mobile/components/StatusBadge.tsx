import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pending', bg: '#FEF3C7', color: '#92400E' },
  confirmed: { label: 'Confirmed', bg: '#D1FAE5', color: '#065F46' },
  on_the_way: { label: 'On The Way', bg: '#DBEAFE', color: '#1E40AF' },
  arrived: { label: 'Arrived', bg: '#DBEAFE', color: '#1E40AF' },
  active: { label: 'Active', bg: '#D1FAE5', color: '#065F46' },
  pickup_ready: { label: 'Pickup Ready', bg: '#FEE2E2', color: '#991B1B' },
  closed: { label: 'Closed', bg: '#F3F4F6', color: '#6B7280' },
  scheduled: { label: 'Scheduled', bg: '#DBEAFE', color: '#1E40AF' },
  completed: { label: 'Completed', bg: '#D1FAE5', color: '#065F46' },
  delivered: { label: 'Delivered', bg: '#F3F4F6', color: '#6B7280' },
  cancelled: { label: 'Cancelled', bg: '#FEE2E2', color: '#991B1B' },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, bg: '#F3F4F6', color: '#6B7280' };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
