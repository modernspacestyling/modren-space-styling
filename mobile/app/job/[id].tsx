import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Colors, Spacing, Radius } from '@/constants/theme';
import StatusBadge from '@/components/StatusBadge';
import CountdownBar from '@/components/CountdownBar';
import { supabase } from '@/lib/supabase';

export default function JobDetailScreen() {
  const { id, type } = useLocalSearchParams<{ id: string; type: string }>();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadJob();
  }, [id, type]);

  const loadJob = async () => {
    const table = type === 'photography' ? 'photo_bookings' : 'bookings';
    const { data } = await supabase.from(table).select('*').eq('id', id).single();
    setJob(data);
    setLoading(false);
  };

  if (loading) {
    return <View style={styles.center}><Text style={styles.loadingText}>Loading...</Text></View>;
  }

  if (!job) {
    return <View style={styles.center}><Text style={styles.loadingText}>Job not found</Text></View>;
  }

  const isStaging = type !== 'photography';
  const jobNumber = job.job_number || '—';
  const address = job.address || '—';
  const status = job.status || 'pending';
  const date = isStaging ? job.install_date : job.preferred_date;
  const time = isStaging ? job.install_time : job.preferred_time;
  const price = job.estimated_price || 0;
  const endDate = job.end_date;

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.jobNumber}>{jobNumber}</Text>
        <StatusBadge status={status} />
        <Text style={styles.typeLabel}>{isStaging ? 'Property Staging' : 'Photography'}</Text>
      </View>

      {/* Countdown (staging only) */}
      {isStaging && endDate && (status === 'active' || status === 'confirmed') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Staging Period</Text>
          <View style={styles.card}>
            <CountdownBar endDate={endDate} />
          </View>
        </View>
      )}

      {/* Property Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Property</Text>
        <View style={styles.card}>
          <DetailRow label="Address" value={address} />
          <DetailRow label="Date" value={formatDate(date)} />
          {time && <DetailRow label="Time" value={time} />}
          {job.bedrooms != null && <DetailRow label="Bedrooms" value={String(job.bedrooms)} />}
          {job.bathrooms != null && <DetailRow label="Bathrooms" value={String(job.bathrooms)} />}
          {isStaging && job.living_areas != null && <DetailRow label="Living Areas" value={String(job.living_areas)} />}
          {!isStaging && job.property_type && <DetailRow label="Type" value={job.property_type === 'sale' ? 'For Sale' : 'For Rent'} />}
          {!isStaging && job.package && <DetailRow label="Package" value={job.package.charAt(0).toUpperCase() + job.package.slice(1)} />}
        </View>
      </View>

      {/* Pricing */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pricing</Text>
        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Estimated Price</Text>
          <Text style={styles.priceValue}>${price.toLocaleString('en-AU')}</Text>
          <Text style={styles.priceNote}>+ GST</Text>
        </View>
      </View>

      {/* Add-ons (photography) */}
      {!isStaging && job.addons && job.addons.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add-Ons</Text>
          <View style={styles.card}>
            {job.addons.map((addon: any, i: number) => (
              <DetailRow
                key={i}
                label={addon.key.replace(/_/g, ' ')}
                value={`+$${addon.key === 'virtual_staging' ? (addon.rooms || 1) * addon.price : addon.price}`}
              />
            ))}
          </View>
        </View>
      )}

      {/* Notes */}
      {job.notes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <View style={styles.card}>
            <Text style={styles.notesText}>{job.notes}</Text>
          </View>
        </View>
      )}

      {/* Contact Info */}
      <View style={[styles.section, { marginBottom: 40 }]}>
        <Text style={styles.sectionTitle}>Contact</Text>
        <View style={styles.card}>
          <DetailRow label="Name" value={isStaging ? job.agent_name : job.client_name} />
          <DetailRow label="Phone" value={isStaging ? job.agent_phone : job.client_phone} />
          <DetailRow label="Email" value={isStaging ? job.agent_email : job.client_email} />
          {job.agency && <DetailRow label="Agency" value={job.agency} />}
        </View>
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: Colors.textSecondary },
  header: {
    backgroundColor: Colors.charcoal, padding: Spacing.lg, alignItems: 'center', paddingBottom: Spacing.xl,
  },
  jobNumber: { fontSize: 24, fontWeight: '800', color: Colors.gold, marginBottom: 8 },
  typeLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 8, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  section: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
    color: Colors.gold, marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.sandLight,
  },
  detailLabel: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  detailValue: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500', textAlign: 'right', flex: 1, marginLeft: 16 },
  priceCard: {
    backgroundColor: Colors.charcoal, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center',
  },
  priceLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  priceValue: { fontSize: 32, fontWeight: '800', color: Colors.gold, marginTop: 4 },
  priceNote: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  notesText: { fontSize: 14, color: Colors.textSecondary, lineHeight: 22 },
});
