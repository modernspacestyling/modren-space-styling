// tests/v1.2-db.test.mjs
// Run with: npm test (requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY env vars)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY in env');
}
export const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false }});

test('profiles RLS: anon read returns 0 rows', async () => {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }});
  const { data, error } = await anon.from('profiles').select('id').limit(1);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test('bookings RLS: anon select returns 0 rows', async () => {
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }});
  const { data, error } = await anon.from('bookings').select('id').limit(1);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test('bookings backfill linked at least one Mandeep booking', async () => {
  const { data, error } = await admin
    .from('bookings')
    .select('id, agent_email, user_id')
    .ilike('agent_email', 'modernspacestyling@gmail.com')
    .not('user_id', 'is', null)
    .limit(1);
  assert.equal(error, null);
  assert.ok(data.length >= 1, 'expected at least 1 linked booking');
});
