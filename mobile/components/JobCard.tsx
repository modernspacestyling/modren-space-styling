import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Colors, Radius, Spacing } from '@/constants/theme';
import StatusBadge from './StatusBadge';
import CountdownBar from './CountdownBar';

interface Props {
  id: string;
  jobNumber: string;
  address: string;
  status: string;
  date: string;
  endDate?: string;
  price?: number;
  type: 'staging' | 'photography';
  packageName?: string;
}

export default function JobCard({ id, jobNumber, address, status, date, endDate, price, type, packageName }: Props) {
  const borderColor = {
    pending: Colors.warning,
    confirmed: Colors.info,
    active: Colors.success,
    pickup_ready: Colors.danger,
    closed: Colors.textMuted,
    scheduled: Colors.info,
    completed: Colors.success,
    delivered: Colors.textMuted,
  }[status] || Colors.sandLight;

  const typeLabel = type === 'photography' ? '📸 Photography' : '🏠 Staging';
  const formattedDate = new Date(date).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: borderColor }]}
      onPress={() => router.push(`/job/${id}?type=${type}`)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.jobNumber}>{jobNumber}</Text>
          <Text style={styles.typeLabel}>{typeLabel}{packageName ? ` · ${packageName}` : ''}</Text>
        </View>
        <StatusBadge status={status} />
      </View>

      <Text style={styles.address} numberOfLines={2}>{address}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{formattedDate}</Text>
        {price ? <Text style={styles.price}>${price.toLocaleString('en-AU')}</Text> : null}
      </View>

      {endDate && (status === 'active' || status === 'confirmed') && (
        <CountdownBar endDate={endDate} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  jobNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.gold,
  },
  typeLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  address: {
    fontSize: 14,
    color: Colors.textPrimary,
    marginBottom: 8,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  price: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.gold,
  },
});
