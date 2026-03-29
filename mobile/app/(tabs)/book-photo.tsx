import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { createPhotoBooking } from '@/lib/supabase';

const PACKAGES = [
  { key: 'essential', name: 'Essential', price: 349, desc: 'Up to 20 photos' },
  { key: 'premium', name: 'Premium', price: 449, desc: 'Photos + Video + Floor Plan' },
  { key: 'ultimate', name: 'Ultimate', price: 599, desc: 'Full Media Package' },
];

const ADDONS = [
  { key: 'twilight', label: 'Twilight Photography', price: 150 },
  { key: 'drone', label: 'Drone Aerial', price: 200 },
  { key: 'virtual_staging', label: 'Virtual Staging (/room)', price: 100 },
];

export default function BookPhotoScreen() {
  const [form, setForm] = useState({
    clientName: '', clientPhone: '', clientEmail: '', agency: '',
    address: '', preferredDate: '', preferredTime: '09:00',
    propertyType: 'sale' as 'sale' | 'rent',
    bedrooms: '3', bathrooms: '2', notes: '',
  });
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({});
  const [virtualRooms, setVirtualRooms] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  const toggleAddon = (key: string) => {
    setSelectedAddons(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getTotal = () => {
    if (!selectedPkg) return 0;
    const pkg = PACKAGES.find(p => p.key === selectedPkg);
    let total = pkg?.price || 0;
    if (selectedAddons.twilight) total += 150;
    if (selectedAddons.drone) total += 200;
    if (selectedAddons.virtual_staging) total += 100 * (parseInt(virtualRooms) || 1);
    return total;
  };

  const submit = async () => {
    if (!form.clientName || !form.clientPhone || !form.clientEmail || !form.address || !form.preferredDate || !selectedPkg) {
      Alert.alert('Missing Fields', 'Please fill in all required fields and select a package.');
      return;
    }
    setSubmitting(true);
    try {
      const addons: Array<{ key: string; price: number; rooms?: number }> = [];
      if (selectedAddons.twilight) addons.push({ key: 'twilight', price: 150 });
      if (selectedAddons.drone) addons.push({ key: 'drone', price: 200 });
      if (selectedAddons.virtual_staging) addons.push({ key: 'virtual_staging', price: 100, rooms: parseInt(virtualRooms) || 1 });

      const data = await createPhotoBooking({
        ...form,
        package: selectedPkg,
        addons,
        bedrooms: parseInt(form.bedrooms),
        bathrooms: parseInt(form.bathrooms),
        estimatedPrice: getTotal(),
      });
      if (data.success) {
        setSuccess(data.jobNumber);
      } else {
        Alert.alert('Error', data.error || 'Booking failed');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    }
    setSubmitting(false);
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}><Text style={{ fontSize: 32, color: '#fff' }}>&#10003;</Text></View>
        <Text style={styles.successTitle}>Photography Booked!</Text>
        <Text style={styles.successJob}>{success}</Text>
        <Text style={styles.successDesc}>We'll confirm your session via SMS within 2 business hours. Edited images delivered within 24 hours of the shoot.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setSuccess(null); setSelectedPkg(null); }}>
          <Text style={styles.btnText}>Make Another Booking</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.form}>
        <Text style={styles.sectionLabel}>Your Details</Text>
        <TextInput style={styles.input} placeholder="Full Name *" value={form.clientName} onChangeText={v => update('clientName', v)} />
        <TextInput style={styles.input} placeholder="Mobile Number *" value={form.clientPhone} onChangeText={v => update('clientPhone', v)} keyboardType="phone-pad" />
        <TextInput style={styles.input} placeholder="Email Address *" value={form.clientEmail} onChangeText={v => update('clientEmail', v)} keyboardType="email-address" autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Agency Name (Optional)" value={form.agency} onChangeText={v => update('agency', v)} />

        <Text style={styles.sectionLabel}>Property Details</Text>
        <TextInput style={styles.input} placeholder="Property Address *" value={form.address} onChangeText={v => update('address', v)} />

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.toggle, form.propertyType === 'sale' && styles.toggleActive]}
            onPress={() => update('propertyType', 'sale')}>
            <Text style={[styles.toggleText, form.propertyType === 'sale' && styles.toggleTextActive]}>For Sale</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggle, form.propertyType === 'rent' && styles.toggleActive]}
            onPress={() => update('propertyType', 'rent')}>
            <Text style={[styles.toggleText, form.propertyType === 'rent' && styles.toggleTextActive]}>For Rent</Text>
          </TouchableOpacity>
        </View>

        <TextInput style={styles.input} placeholder="Preferred Date (YYYY-MM-DD) *" value={form.preferredDate} onChangeText={v => update('preferredDate', v)} />

        <Text style={styles.sectionLabel}>Select Package *</Text>
        {PACKAGES.map(pkg => (
          <TouchableOpacity
            key={pkg.key}
            style={[styles.pkgCard, selectedPkg === pkg.key && styles.pkgCardSelected]}
            onPress={() => setSelectedPkg(pkg.key)}
          >
            <View style={styles.pkgCardInner}>
              <View>
                <Text style={styles.pkgName}>{pkg.name}</Text>
                <Text style={styles.pkgDesc}>{pkg.desc}</Text>
              </View>
              <Text style={styles.pkgPrice}>${pkg.price}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionLabel}>Add-Ons (Optional)</Text>
        {ADDONS.map(addon => (
          <TouchableOpacity
            key={addon.key}
            style={[styles.addonCard, selectedAddons[addon.key] && styles.addonCardSelected]}
            onPress={() => toggleAddon(addon.key)}
          >
            <View style={styles.checkbox}>
              {selectedAddons[addon.key] && <View style={styles.checkboxFill} />}
            </View>
            <Text style={styles.addonLabel}>{addon.label}</Text>
            <Text style={styles.addonPrice}>+${addon.price}</Text>
          </TouchableOpacity>
        ))}

        {selectedAddons.virtual_staging && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.fieldLabel}>How many rooms?</Text>
            <TextInput style={styles.input} value={virtualRooms} onChangeText={setVirtualRooms} keyboardType="number-pad" />
          </View>
        )}

        <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Special Instructions" value={form.notes} onChangeText={v => update('notes', v)} multiline />

        {/* Price summary */}
        {selectedPkg && (
          <View style={styles.pricePanel}>
            <Text style={styles.pricePanelTitle}>Total (excl. GST)</Text>
            <Text style={styles.pricePanelAmount}>${getTotal().toLocaleString('en-AU')}</Text>
          </View>
        )}

        <TouchableOpacity style={[styles.btn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
          <Text style={styles.btnText}>{submitting ? 'Submitting...' : 'Book Photography'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  form: { padding: Spacing.md },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
    color: Colors.gold, marginTop: 20, marginBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(200,162,74,0.2)', paddingBottom: 8,
  },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.sandLight,
    borderRadius: Radius.md, padding: 14, fontSize: 15, marginBottom: 10,
    color: Colors.textPrimary,
  },
  row: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  toggle: {
    flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 2,
    borderColor: Colors.sandLight, alignItems: 'center', marginBottom: 10,
  },
  toggleActive: { backgroundColor: Colors.charcoal, borderColor: Colors.charcoal },
  toggleText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },
  pkgCard: {
    backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.sandLight,
    borderRadius: Radius.lg, padding: 16, marginBottom: 10,
  },
  pkgCardSelected: { borderColor: Colors.gold, backgroundColor: 'rgba(200,162,74,0.04)' },
  pkgCardInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pkgName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  pkgDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  pkgPrice: { fontSize: 22, fontWeight: '800', color: Colors.gold },
  addonCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.sandLight,
    borderRadius: Radius.md, padding: 14, marginBottom: 8,
  },
  addonCardSelected: { borderColor: Colors.gold, backgroundColor: 'rgba(200,162,74,0.04)' },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 2,
    borderColor: Colors.sandLight, justifyContent: 'center', alignItems: 'center',
  },
  checkboxFill: { width: 12, height: 12, borderRadius: 2, backgroundColor: Colors.gold },
  addonLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  addonPrice: { fontSize: 15, fontWeight: '700', color: Colors.gold },
  pricePanel: {
    backgroundColor: Colors.charcoal, borderRadius: Radius.lg, padding: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12,
  },
  pricePanelTitle: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  pricePanelAmount: { fontSize: 26, fontWeight: '800', color: Colors.gold },
  btn: {
    backgroundColor: Colors.gold, padding: 16, borderRadius: Radius.md,
    alignItems: 'center', marginTop: 16, marginBottom: 40,
  },
  btnText: { color: Colors.charcoal, fontSize: 16, fontWeight: '700' },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: Colors.cream },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.success, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  successJob: { fontSize: 28, fontWeight: '800', color: Colors.gold, marginBottom: 12 },
  successDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
});
