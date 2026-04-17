import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { createStagingBooking } from '@/lib/supabase';

export default function BookStagingScreen() {
  const [form, setForm] = useState({
    agentName: '', agentPhone: '', agentEmail: '', agency: '',
    address: '', installDate: '', installTime: '09:00',
    bedrooms: '3', bathrooms: '2', livingAreas: '1', diningAreas: '1',
    garage: false, vacant: true, lockbox: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const update = (key: string, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.agentName || !form.agentPhone || !form.agentEmail || !form.address || !form.installDate || !form.lockbox) {
      Alert.alert('Missing Fields', 'Please fill in all required fields.');
      return;
    }
    setSubmitting(true);
    try {
      const data = await createStagingBooking({
        ...form,
        bedrooms: parseInt(form.bedrooms),
        bathrooms: parseInt(form.bathrooms),
        livingAreas: parseInt(form.livingAreas),
        diningAreas: parseInt(form.diningAreas),
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
        <Text style={styles.successTitle}>Booking Submitted!</Text>
        <Text style={styles.successJob}>{success}</Text>
        <Text style={styles.successDesc}>We'll confirm via SMS within 2 business hours.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setSuccess(null); setForm(f => ({ ...f, agentName: '', address: '', lockbox: '' })); }}>
          <Text style={styles.btnText}>Make Another Booking</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.form}>
        <Text style={styles.sectionLabel}>Agent Details</Text>
        <TextInput style={styles.input} placeholder="Full Name *" value={form.agentName} onChangeText={v => update('agentName', v)} />
        <TextInput style={styles.input} placeholder="Mobile Number *" value={form.agentPhone} onChangeText={v => update('agentPhone', v)} keyboardType="phone-pad" />
        <TextInput style={styles.input} placeholder="Email Address *" value={form.agentEmail} onChangeText={v => update('agentEmail', v)} keyboardType="email-address" autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Agency Name *" value={form.agency} onChangeText={v => update('agency', v)} />

        <Text style={styles.sectionLabel}>Property Details</Text>
        <TextInput style={styles.input} placeholder="Property Address *" value={form.address} onChangeText={v => update('address', v)} />
        <TextInput style={styles.input} placeholder="Install Date (YYYY-MM-DD) *" value={form.installDate} onChangeText={v => update('installDate', v)} />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>Bedrooms</Text>
            <TextInput style={styles.input} value={form.bedrooms} onChangeText={v => update('bedrooms', v)} keyboardType="number-pad" />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>Bathrooms</Text>
            <TextInput style={styles.input} value={form.bathrooms} onChangeText={v => update('bathrooms', v)} keyboardType="number-pad" />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>Living Areas</Text>
            <TextInput style={styles.input} value={form.livingAreas} onChangeText={v => update('livingAreas', v)} keyboardType="number-pad" />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>Dining Areas</Text>
            <TextInput style={styles.input} value={form.diningAreas} onChangeText={v => update('diningAreas', v)} keyboardType="number-pad" />
          </View>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.toggle, form.vacant && styles.toggleActive]}
            onPress={() => update('vacant', true)}>
            <Text style={[styles.toggleText, form.vacant && styles.toggleTextActive]}>Vacant</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggle, !form.vacant && styles.toggleActive]}
            onPress={() => update('vacant', false)}>
            <Text style={[styles.toggleText, !form.vacant && styles.toggleTextActive]}>Occupied</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Access &amp; Security</Text>
        <TextInput style={styles.input} placeholder="Lockbox Code *" value={form.lockbox} onChangeText={v => update('lockbox', v)} secureTextEntry />
        <Text style={styles.hint}>Encrypted with AES-256. Only authorised team can access.</Text>

        <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Additional Notes" value={form.notes} onChangeText={v => update('notes', v)} multiline />

        <TouchableOpacity style={[styles.btn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
          <Text style={styles.btnText}>{submitting ? 'Submitting...' : 'Submit Booking'}</Text>
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
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.sandLight,
    borderRadius: Radius.md, padding: 14, fontSize: 15, marginBottom: 10,
    color: Colors.textPrimary,
  },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  rowItem: { flex: 1 },
  toggle: {
    flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 2,
    borderColor: Colors.sandLight, alignItems: 'center', marginBottom: 10,
  },
  toggleActive: { backgroundColor: Colors.charcoal, borderColor: Colors.charcoal },
  toggleText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },
  hint: { fontSize: 11, color: Colors.textMuted, marginTop: -6, marginBottom: 12 },
  btn: {
    backgroundColor: Colors.gold, padding: 16, borderRadius: Radius.md,
    alignItems: 'center', marginTop: 16, marginBottom: 40,
  },
  btnText: { color: Colors.charcoal, fontSize: 16, fontWeight: '700' },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: Colors.cream },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.success, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  successJob: { fontSize: 28, fontWeight: '800', color: Colors.gold, marginBottom: 12 },
  successDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24 },
});
