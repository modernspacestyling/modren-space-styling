import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { register } from '@/lib/auth';

export default function RegisterScreen() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', agency: '',
    password: '', confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  const handleRegister = async () => {
    const { name, email, phone, agency, password, confirmPassword } = form;
    if (!name || !email || !phone || !agency || !password) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    const { success, error } = await register({ name, email, phone, agency, password });
    setLoading(false);

    if (success) {
      Alert.alert(
        'Registration Submitted',
        'Your account is pending admin approval. You will be notified via SMS once approved.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } else {
      Alert.alert('Registration Failed', error || 'Please try again.');
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <Text style={styles.title}>Register as Agent</Text>
        <Text style={styles.desc}>Create your account to access the booking portal and track your staging jobs.</Text>

        <TextInput style={styles.input} placeholder="Full Name *" value={form.name} onChangeText={v => update('name', v)} />
        <TextInput style={styles.input} placeholder="Email Address *" value={form.email} onChangeText={v => update('email', v)} keyboardType="email-address" autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Mobile Number *" value={form.phone} onChangeText={v => update('phone', v)} keyboardType="phone-pad" />
        <TextInput style={styles.input} placeholder="Agency Name *" value={form.agency} onChangeText={v => update('agency', v)} />
        <TextInput style={styles.input} placeholder="Password (min 8 chars) *" value={form.password} onChangeText={v => update('password', v)} secureTextEntry />
        <TextInput style={styles.input} placeholder="Confirm Password *" value={form.confirmPassword} onChangeText={v => update('confirmPassword', v)} secureTextEntry />

        <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={handleRegister} disabled={loading}>
          <Text style={styles.btnText}>{loading ? 'Registering...' : 'Register'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.link} onPress={() => router.back()}>
          <Text style={styles.linkText}>Already have an account? <Text style={{ color: Colors.gold, fontWeight: '700' }}>Sign In</Text></Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  inner: { padding: Spacing.lg, paddingTop: 20 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  desc: { fontSize: 14, color: Colors.textSecondary, marginBottom: 24, lineHeight: 22 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.sandLight,
    borderRadius: Radius.md, padding: 16, fontSize: 16, marginBottom: 12,
    color: Colors.textPrimary,
  },
  btn: {
    backgroundColor: Colors.gold, padding: 16, borderRadius: Radius.md,
    alignItems: 'center', marginTop: 12,
  },
  btnText: { color: Colors.charcoal, fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 24, marginBottom: 40 },
  linkText: { fontSize: 14, color: Colors.textSecondary },
});
