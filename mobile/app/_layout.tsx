import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '@/constants/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.charcoal },
          headerTintColor: Colors.gold,
          headerTitleStyle: { fontWeight: '700', fontSize: 16 },
          contentStyle: { backgroundColor: Colors.cream },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/login" options={{ title: 'Sign In', presentation: 'modal' }} />
        <Stack.Screen name="(auth)/register" options={{ title: 'Register', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job Details' }} />
      </Stack>
    </>
  );
}
