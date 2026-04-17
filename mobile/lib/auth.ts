import { supabase } from './supabase';

export type UserRole = 'admin' | 'agent' | 'staff';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  agency?: string;
  role: UserRole;
  status: string;
}

export async function signIn(email: string, password: string): Promise<{ user: AppUser | null; error: string | null }> {
  // Hash password same way as web app (SHA-256)
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const { data: agents, error } = await supabase
    .from('agents')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('password_hash', passwordHash)
    .single();

  if (error || !agents) {
    return { user: null, error: 'Invalid email or password' };
  }

  if (agents.status !== 'approved') {
    return { user: null, error: 'Your account is pending approval' };
  }

  const user: AppUser = {
    id: agents.id,
    email: agents.email,
    name: agents.name,
    phone: agents.phone,
    agency: agents.agency,
    role: agents.role,
    status: agents.status,
  };

  return { user, error: null };
}

export async function register(data: {
  name: string;
  email: string;
  phone: string;
  agency: string;
  password: string;
}): Promise<{ success: boolean; error: string | null }> {
  const encoder = new TextEncoder();
  const hashData = encoder.encode(data.password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const { error } = await supabase
    .from('agents')
    .insert({
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone,
      agency: data.agency,
      password_hash: passwordHash,
      role: 'agent',
      status: 'pending',
    });

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'An account with this email already exists' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}
