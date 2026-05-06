# 🤖 MSS Expense Bot — Setup Steps

The Telegram bot now supports 2-way: Mini, Sony, and Mandeep send receipts (photos
or text) → bot parses → adds to Supabase `expenses` → all admin pages sync.

After deploying to Vercel, do these 4 steps **in order**.

---

## 1️⃣ Create the `expenses` table in Supabase

1. Open https://supabase.com/dashboard/project/wmkbzmrgtkcksucwallj/sql/new
2. Paste the entire contents of `supabase/migration_expenses.sql`
3. Click **Run**

Verify with:
```sql
SELECT count(*) FROM expenses;
```
Should return 0.

Optional: create a private storage bucket for receipt images.
- Storage → New bucket → name: `receipts` → Public: **off**

---

## 2️⃣ Add Vercel environment variables

Project → Settings → Environment Variables → add these 5 (Production scope):

| Name | Value |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | `8517203736:AAGHFHpBeSf-6rH3wWQkeCOS-9jJZiOrn7I` |
| `TELEGRAM_WEBHOOK_SECRET` | `023edc825ffb66a77231ee3edc8084803e993e072525e421162287a8b0a79957` |
| `TELEGRAM_OWNER_CHAT_ID` | `8659144572` |
| `ANTHROPIC_API_KEY` | *(copy from `~/.env.shared`)* |
| `SUPABASE_URL` | *(should already exist)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(should already exist)* |

After saving, **Redeploy** the latest production deploy so the new vars take effect.

---

## 3️⃣ Register the webhook with Telegram

Run this once from your machine (token + secret already filled in):

```bash
curl -s "https://api.telegram.org/bot8517203736:AAGHFHpBeSf-6rH3wWQkeCOS-9jJZiOrn7I/setWebhook" \
  -d "url=https://www.modernspacestyling.com.au/api/telegram-webhook?secret=023edc825ffb66a77231ee3edc8084803e993e072525e421162287a8b0a79957" \
  -d "allowed_updates=[\"message\",\"edited_message\"]"
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

Verify it's set:
```bash
curl -s "https://api.telegram.org/bot8517203736:AAGHFHpBeSf-6rH3wWQkeCOS-9jJZiOrn7I/getWebhookInfo"
```
The `url` field should match what you set above.

⚠️ **Note:** Setting a webhook **disables** the daily content drop bot's polling
mode. If the daily 7am drop is still using `getUpdates` it will stop working.
Switch the daily drop to push to chat ID `8659144572` directly via `sendMessage`
(no polling needed).

To **remove** the webhook later:
```bash
curl -s "https://api.telegram.org/bot8517203736:AAGHFHpBeSf-6rH3wWQkeCOS-9jJZiOrn7I/deleteWebhook"
```

---

## 4️⃣ Test it

In Telegram, open @MSStylingbot and send:

```
help
```

You should get back the command list. Then test a real receipt:

```
expense 12.50 supplies test entry
```

Reply should be:
> ✅ *Added*
> **test entry**
> $12.50 · supplies · 2026-05-06

Then in admin:
1. Open `/admin/expenses.html`
2. The test entry should appear at the top of the table
3. Open `/admin/dashboard.html` → Expenses card should show $12.50 for May 2026

If yes → ship it. Snap a receipt photo and watch the OCR magic.

---

## Commands Mini and Sony can use

| Command | Effect |
|---------|--------|
| 📸 Send a photo | OCR'd into expense automatically |
| `expense 47.50 supplies Bunnings X` | Manual text entry |
| `last` | Show last 5 expenses |
| `total` | Today + this month totals |
| `undo` | Remove the last one they added |
| `help` | Show command list |

Categories accepted: `rent insurance truck designer supplies photography software other`

---

## Troubleshooting

**Bot doesn't respond:**
1. `getWebhookInfo` — check `last_error_date` and `last_error_message`
2. Check Vercel logs: `vercel logs --prod` filter for `[telegram-webhook]`
3. Confirm chat ID matches `ALLOWED_CHAT_IDS` in `api/telegram-webhook.js`

**"Could not read receipt":**
- Image too dark / blurry — try again with a clearer photo
- Anthropic API key invalid — check Vercel env vars
- Image > 5MB — bot rejects, ask sender to crop or compress

**Expense added but not showing on dashboard:**
- Open DevTools console on `/admin/dashboard.html`, paste:
  `localStorage.removeItem('mss_expenses'); location.reload();`
- Refresh — sync should pull the latest from Supabase.
