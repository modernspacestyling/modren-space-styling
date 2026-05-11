#!/usr/bin/env bash
# Seed MSS admin auth users in the new Supabase project.
#
# This INVITES the four admin emails so they receive a "set your password"
# email from Supabase. Nothing is created with a password by us.
#
# Run AFTER setup_v2.sql has been applied successfully.
#
# Usage:  ./supabase/seed_admin_users.sh
# Pre-req: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY available in env, OR
#          they can be hardcoded below if you prefer.

set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://wmkbzmrgtkcksucwallj.supabase.co}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indta2J6bXJndGtja3N1Y3dhbGxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTkzNjMzMCwiZXhwIjoyMDg3NTEyMzMwfQ.fK1dwPJJ04rtcir3hCz08TTOKjiSTdWS5P7uuagHIvA}"

ADMINS=(
  "modernspacestyling@gmail.com"
  "bhumika.sood1@gmail.com"
  "rathore6@gmail.com"
  "hundalteji@gmail.com"
)

REDIRECT="https://www.modernspacestyling.com.au/admin/login.html"

for email in "${ADMINS[@]}"; do
  echo "→ Inviting $email …"
  curl -sS -X POST "$SUPABASE_URL/auth/v1/invite" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"options\":{\"redirectTo\":\"$REDIRECT\"}}"
  echo ""
done

echo "Done. Each admin should receive an email from Supabase to set their password."
