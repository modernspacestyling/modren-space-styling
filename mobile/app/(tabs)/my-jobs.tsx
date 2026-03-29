import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import JobCard from '@/components/JobCard';
import { fetchMyBookings } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';

type Tab = 'all' | 'staging' | 'photography';

export default function MyJobsScreen() {
  const [tab, setTab] = useState<Tab>('all');
  const [stagingJobs, setStagingJobs] = useState<any[]>([]);
  const [photoJobs, setPhotoJobs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const stored = await SecureStore.getItemAsync('mss_user');
    if (stored) {
      const user = JSON.parse(stored);
      setUserEmail(user.email);
      loadJobs(user.email);
    }
  };

  const loadJobs = async (email: string) => {
    try {
      const { staging, photography } = await fetchMyBookings(email);
      setStagingJobs(staging);
      setPhotoJobs(photography);
    } catch {
      // Fallback: empty
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (userEmail) await loadJobs(userEmail);
    setRefreshing(false);
  };

  const allJobs = [
    ...stagingJobs.map(j => ({ ...j, _type: 'staging' as const })),
    ...photoJobs.map(j => ({ ...j, _type: 'photography' as const })),
  ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const filtered = tab === 'all' ? allJobs
    : tab === 'staging' ? allJobs.filter(j => j._type === 'staging')
    : allJobs.filter(j => j._type === 'photography');

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />}
    >
      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['all', 'staging', 'photography'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'all' ? `All (${allJobs.length})` : t === 'staging' ? `Staging (${stagingJobs.length})` : `Photos (${photoJobs.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Job List */}
      <View style={styles.list}>
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Bookings Yet</Text>
            <Text style={styles.emptyDesc}>Book a staging or photography session to see your jobs here.</Text>
          </View>
        ) : (
          filtered.map(job => (
            <JobCard
              key={job.id}
              id={job.id}
              jobNumber={job.job_number || job.jobNumber || '—'}
              address={job.address || ''}
              status={job.status || 'pending'}
              date={job._type === 'staging' ? (job.install_date || job.installDate || '') : (job.preferred_date || job.preferredDate || '')}
              endDate={job._type === 'staging' ? (job.end_date || job.endDate) : undefined}
              price={job.estimated_price || job.estimatedPrice || 0}
              type={job._type}
              packageName={job._type === 'photography' ? job.package : undefined}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    padding: 4,
    margin: Spacing.md,
    borderRadius: Radius.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Radius.sm,
  },
  tabActive: {
    backgroundColor: Colors.charcoal,
  },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },
  list: { paddingHorizontal: Spacing.md, paddingBottom: 40 },
  emptyState: { alignItems: 'center', paddingTop: 60, paddingBottom: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 },
});
