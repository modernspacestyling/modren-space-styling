import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.gold,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.charcoal,
          borderTopColor: 'rgba(255,255,255,0.08)',
          paddingBottom: 4,
          height: 56,
        },
        headerStyle: { backgroundColor: Colors.charcoal },
        headerTintColor: Colors.white,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          headerTitle: 'Modern Space Styling',
        }}
      />
      <Tabs.Screen
        name="book-staging"
        options={{
          title: 'Staging',
          tabBarIcon: ({ color, size }) => <Ionicons name="bed" size={size} color={color} />,
          headerTitle: 'Book Staging',
        }}
      />
      <Tabs.Screen
        name="book-photo"
        options={{
          title: 'Photography',
          tabBarIcon: ({ color, size }) => <Ionicons name="camera" size={size} color={color} />,
          headerTitle: 'Book Photography',
        }}
      />
      <Tabs.Screen
        name="my-jobs"
        options={{
          title: 'My Jobs',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
          headerTitle: 'My Bookings',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
          headerTitle: 'My Account',
        }}
      />
    </Tabs>
  );
}
