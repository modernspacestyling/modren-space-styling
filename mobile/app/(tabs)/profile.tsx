import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { registerForPushNotifications } from '@/lib/notifications';

interface UserData {
  name: string;
  email: string;
  phone?: string;
  agency?: string;
  role: string;
}

export default function ProfileScreen() {
  const [user, setUser] = useState<UserData | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const stored = await SecureStore.getItemAsync('mss_user');
    if (stored) {
      setUser(JSON.parse(stored));
    }
  };

  const handleLogin = () => router.push('/(auth)/login');
  const handleRegister = () => router.push('/(auth)/register');

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('mss_user');
    setUser(null);
  };

  const enableNotifications = async () => {
    const token = await registerForPushNotifications();
    if (token) {
      setPushEnabled(true);
      Alert.alert('Notifications Enabled', 'You will receive updates about your bookings.');
    } else {
      Alert.alert('Permission Denied', 'Please enable notifications in your device settings.');
    }
  };

  if (!user) {
    return (
      <View style={styles.authContainer}>
        <View style={styles.authIcon}>
          <Ionicons name="person-circle-outline" size={80} color={Colors.gold} />
        </View>
        <Text style={styles.authTitle}>Welcome to{'\n'}Modern Space Styling</Text>
        <Text style={styles.authDesc}>Sign in to manage your bookings, track jobs, and request extensions.</Text>
        <TouchableOpacity style={styles.btn} onPress={handleLogin}>
          <Text style={styles.btnText}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={handleRegister}>
          <Text style={styles.btnSecondaryText}>Register as Agent</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.userName}>{user.name}</Text>
        <Text style={styles.userRole}>{user.role === 'admin' ? 'Administrator' : 'Real Estate Agent'}</Text>
        {user.agency && <Text style={styles.userAgency}>{user.agency}</Text>}
      </View>

      {/* Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.detailCard}>
          <DetailRow icon="mail" label="Email" value={user.email} />
          {user.phone && <DetailRow icon="call" label="Phone" value={user.phone} />}
          {user.agency && <DetailRow icon="business" label="Agency" value={user.agency} />}
        </View>
      </View>

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>
        <TouchableOpacity style={styles.settingRow} onPress={enableNotifications}>
          <Ionicons name="notifications" size={20} color={Colors.gold} />
          <Text style={styles.settingLabel}>Push Notifications</Text>
          <Text style={styles.settingValue}>{pushEnabled ? 'Enabled' : 'Tap to enable'}</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Links */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Links</Text>
        <TouchableOpacity style={styles.settingRow} onPress={() => router.push('/(tabs)/book-staging')}>
          <Ionicons name="bed" size={20} color={Colors.gold} />
          <Text style={styles.settingLabel}>Book Staging</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingRow} onPress={() => router.push('/(tabs)/book-photo')}>
          <Ionicons name="camera" size={20} color={Colors.gold} />
          <Text style={styles.settingLabel}>Book Photography</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingRow} onPress={() => router.push('/(tabs)/my-jobs')}>
          <Ionicons name="list" size={20} color={Colors.gold} />
          <Text style={styles.settingLabel}>My Bookings</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out" size={18} color={Colors.danger} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon as any} size={18} color={Colors.gold} />
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  authContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: Colors.cream },
  authIcon: { marginBottom: 24 },
  authTitle: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: 12, lineHeight: 32 },
  authDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 32, lineHeight: 22, paddingHorizontal: 16 },
  btn: { backgroundColor: Colors.gold, padding: 16, borderRadius: Radius.md, width: '100%', alignItems: 'center', marginBottom: 12 },
  btnText: { color: Colors.charcoal, fontSize: 16, fontWeight: '700' },
  btnSecondary: { borderWidth: 2, borderColor: Colors.charcoal, padding: 16, borderRadius: Radius.md, width: '100%', alignItems: 'center' },
  btnSecondaryText: { color: Colors.charcoal, fontSize: 16, fontWeight: '700' },
  profileHeader: {
    backgroundColor: Colors.charcoal, padding: 24, alignItems: 'center', paddingBottom: 32,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.gold,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: Colors.charcoal },
  userName: { fontSize: 20, fontWeight: '700', color: Colors.white },
  userRole: { fontSize: 13, color: Colors.gold, marginTop: 4, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  userAgency: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  section: { padding: Spacing.md, paddingBottom: 0 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.gold, marginBottom: 12 },
  detailCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.sandLight },
  detailLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14,
    marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  settingLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: Colors.textPrimary },
  settingValue: { fontSize: 12, color: Colors.textMuted },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: Spacing.md, marginTop: 24, padding: 14,
    borderWidth: 1.5, borderColor: Colors.danger, borderRadius: Radius.md,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.danger },
});
