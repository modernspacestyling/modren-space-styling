import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import JobCard from '@/components/JobCard';

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    // TODO: Fetch from Supabase when authenticated
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />}
    >
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Transform Spaces.{'\n'}Sell Faster.</Text>
        <Text style={styles.heroDesc}>Property staging and photography for Geelong's leading real estate agents.</Text>
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Book</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/(tabs)/book-staging')}>
            <Ionicons name="bed" size={28} color={Colors.gold} />
            <Text style={styles.actionLabel}>Book{'\n'}Staging</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/(tabs)/book-photo')}>
            <Ionicons name="camera" size={28} color={Colors.gold} />
            <Text style={styles.actionLabel}>Book{'\n'}Photography</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/(tabs)/my-jobs')}>
            <Ionicons name="list" size={28} color={Colors.gold} />
            <Text style={styles.actionLabel}>View{'\n'}My Jobs</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Staging Packages */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Staging Packages</Text>
        <View style={styles.packageRow}>
          <View style={styles.packageCard}>
            <Text style={styles.pkgName}>3 Bedroom</Text>
            <Text style={styles.pkgPrice}>from ~$2,000</Text>
            <Text style={styles.pkgNote}>+ GST · 6-week base</Text>
          </View>
          <View style={[styles.packageCard, styles.packageFeatured]}>
            <View style={styles.popularTag}><Text style={styles.popularText}>POPULAR</Text></View>
            <Text style={styles.pkgName}>4 Bedroom</Text>
            <Text style={styles.pkgPrice}>from ~$2,500</Text>
            <Text style={styles.pkgNote}>+ GST · 6-week base</Text>
          </View>
        </View>
      </View>

      {/* Photography Packages */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photography Packages</Text>
        <View style={styles.photoRow}>
          {[
            { name: 'Essential', price: '$349', desc: 'Photos only' },
            { name: 'Premium', price: '$449', desc: 'Photos + Video + Plan' },
            { name: 'Ultimate', price: '$599', desc: 'Full Media Package' },
          ].map((pkg, i) => (
            <TouchableOpacity
              key={pkg.name}
              style={[styles.photoPkg, i === 1 && styles.photoPkgFeatured]}
              onPress={() => router.push('/(tabs)/book-photo')}
            >
              <Text style={styles.photoPkgName}>{pkg.name}</Text>
              <Text style={styles.photoPkgPrice}>{pkg.price}</Text>
              <Text style={styles.photoPkgDesc}>{pkg.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Contact */}
      <View style={[styles.section, { marginBottom: 40 }]}>
        <Text style={styles.sectionTitle}>Contact Us</Text>
        <View style={styles.contactCard}>
          <Text style={styles.contactItem}>📞 0415 580 791 | 0421 237 861</Text>
          <Text style={styles.contactItem}>✉ modrenspacestyling@gmail.com</Text>
          <Text style={styles.contactItem}>📍 Geelong, VIC 3220</Text>
          <Text style={styles.contactNote}>Mon-Fri 8am-5pm · Sat 9am-2pm</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  hero: {
    backgroundColor: Colors.charcoal,
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.white,
    lineHeight: 34,
    marginBottom: 8,
  },
  heroDesc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 22,
  },
  section: {
    padding: Spacing.md,
    paddingTop: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    letterSpacing: 0.3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },
  packageRow: {
    flexDirection: 'row',
    gap: 12,
  },
  packageCard: {
    flex: 1,
    backgroundColor: Colors.charcoal,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'center',
  },
  packageFeatured: {
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  popularTag: {
    backgroundColor: Colors.gold,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    marginBottom: 6,
  },
  popularText: { fontSize: 9, fontWeight: '800', color: Colors.charcoal, letterSpacing: 0.5 },
  pkgName: { fontSize: 13, fontWeight: '700', color: Colors.gold, letterSpacing: 0.5, textTransform: 'uppercase' },
  pkgPrice: { fontSize: 18, fontWeight: '800', color: Colors.white, marginTop: 4 },
  pkgNote: { fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  photoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  photoPkg: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  photoPkgFeatured: {
    borderWidth: 1.5,
    borderColor: Colors.gold,
  },
  photoPkgName: { fontSize: 12, fontWeight: '700', color: Colors.gold, textTransform: 'uppercase', letterSpacing: 0.5 },
  photoPkgPrice: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary, marginTop: 4 },
  photoPkgDesc: { fontSize: 10, color: Colors.textMuted, marginTop: 2, textAlign: 'center' },
  contactCard: {
    backgroundColor: Colors.charcoal,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  contactItem: { fontSize: 14, color: Colors.white, marginBottom: 8 },
  contactNote: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4 },
});
