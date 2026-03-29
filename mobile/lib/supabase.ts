import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ── Booking helpers ──

export async function fetchMyBookings(email: string) {
  const { data: stagingBookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('agent_email', email.toLowerCase())
    .order('created_at', { ascending: false });

  const { data: photoBookings } = await supabase
    .from('photo_bookings')
    .select('*')
    .eq('client_email', email.toLowerCase())
    .order('created_at', { ascending: false });

  return {
    staging: stagingBookings || [],
    photography: photoBookings || [],
  };
}

export async function createStagingBooking(data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL.replace('.supabase.co', '.vercel.app')}/api/create-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function createPhotoBooking(data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL.replace('.supabase.co', '.vercel.app')}/api/create-photo-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return resp.json();
}
