import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { signIn } from '@/lib/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { user, error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      Alert.alert('Login Failed', error);
      return;
    }
    if (user) {
      await SecureStore.setItemAsync('mss_user', JSON.stringify(user));
      router.replace('/(tabs)/home');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Modern Space Styling</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email Address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.6 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.link} onPress={() => router.push('/(auth)/register')}>
          <Text style={styles.linkText}>Don't have an account? <Text style={{ color: Colors.gold, fontWeight: '700' }}>Register</Text></Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream, justifyContent: 'center', padding: Spacing.lg },
  header: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 8 },
  form: {},
  input: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.sandLight,
    borderRadius: Radius.md, padding: 16, fontSize: 16, marginBottom: 12,
    color: Colors.textPrimary,
  },
  btn: {
    backgroundColor: Colors.gold, padding: 16, borderRadius: Radius.md,
    alignItems: 'center', marginTop: 8,
  },
  btnText: { color: Colors.charcoal, fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 24 },
  linkText: { fontSize: 14, color: Colors.textSecondary },
});
