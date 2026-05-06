/**
 * /api/telegram-webhook.js
 *
 * Receives messages from @MSStylingbot and turns them into expense entries
 * for Mini, Sony, and Mandeep (they share one Telegram account).
 *
 * Supported commands:
 *   • <photo of receipt>            → Claude vision parses → adds expense
 *   • expense 47.50 supplies Bunnings concrete pour
 *   • expense 89 fuel BP Lara
 *   • last                          → shows last 5 expenses
 *   • total                         → today + this month totals
 *   • undo                          → removes last expense added via Telegram
 *   • help / /start                 → shows command list
 *
 * Security:
 *   - Webhook URL includes a secret token (TELEGRAM_WEBHOOK_SECRET)
 *     so the public endpoint can't be spammed by randoms
 *   - Only messages from ALLOWED_CHAT_IDS are processed
 *
 * Env vars required on Vercel:
 *   TELEGRAM_BOT_TOKEN          (8517203736:AAGHFHpBeSf-...)
 *   TELEGRAM_WEBHOOK_SECRET     (random string, generate with `openssl rand -hex 32`)
 *   TELEGRAM_OWNER_CHAT_ID      (8659144572 — Mandeep/Mini/Sony shared)
 *   ANTHROPIC_API_KEY           (sk-ant-... for receipt OCR)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const TELEGRAM_API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

const ALLOWED_CHAT_IDS = new Set([
    8659144572, // Mandeep / Mini / Sony shared
]);

const VALID_CATEGORIES = new Set([
    'rent', 'insurance', 'truck', 'designer',
    'supplies', 'photography', 'software', 'other',
]);

// ─── Helpers ────────────────────────────────────────────────

async function tgSend(token, chatId, text, opts = {}) {
    const res = await fetch(TELEGRAM_API(token, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...opts,
        }),
    });
    return res.json();
}

async function tgGetFileUrl(token, fileId) {
    const res = await fetch(TELEGRAM_API(token, 'getFile') + `?file_id=${encodeURIComponent(fileId)}`);
    const j = await res.json();
    if (!j.ok) throw new Error('getFile failed: ' + JSON.stringify(j));
    return `https://api.telegram.org/file/bot${token}/${j.result.file_path}`;
}

async function downloadImageAsBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('image download failed: ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return { b64: buf.toString('base64'), bytes: buf.length };
}

function fmtAud(n) {
    return '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function monthKeyFor(iso) {
    return (iso || todayIso()).slice(0, 7);
}

// ─── Anthropic vision: receipt → structured JSON ────────────

async function parseReceiptImage(b64) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing on server');

    const prompt = `You are an expense-receipt parser for an Australian home staging business (Modern Space Styling).

Extract these fields from the receipt image and return ONLY valid minified JSON, no prose, no markdown fences:

{
  "vendor":      "string — shop name, e.g. Bunnings, BP, Officeworks",
  "date":        "YYYY-MM-DD — receipt date; use today's date if illegible",
  "amount_ex_gst": number,
  "gst":         number,
  "total":       number,
  "category":    "one of: rent, insurance, truck, designer, supplies, photography, software, other",
  "description": "short summary, e.g. 'Bunnings — concrete & screws'",
  "confidence":  "high | medium | low"
}

Rules:
- All money in AUD numbers (no currency symbol, no thousands separator)
- If GST not shown, calculate as total/11 (Australian 10% GST included in total)
- Then amount_ex_gst = total - gst
- Category mapping: fuel/transport/rego → truck, hardware/materials → supplies,
  software/subscriptions → software, photography gear → photography, otherwise other
- If you cannot read the receipt at all, return: {"error":"unreadable"}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 512,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                    { type: 'text', text: prompt },
                ],
            }],
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error('Anthropic API ' + res.status + ': ' + err.slice(0, 200));
    }
    const json = await res.json();
    const text = (json.content && json.content[0] && json.content[0].text) || '';
    // Be forgiving: extract first {...} block in case the model wraps it
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in model output: ' + text.slice(0, 200));
    return JSON.parse(match[0]);
}

// ─── Text command parser ────────────────────────────────────

// Accepts: "expense 47.50 supplies Bunnings concrete & screws"
// Returns null if not parseable
function parseExpenseText(text) {
    const m = text.match(/^expense\s+([\d.]+)\s+(\w+)\s+(.+)$/i);
    if (!m) return null;
    const total = parseFloat(m[1]);
    const cat = m[2].toLowerCase();
    const desc = m[3].trim();
    if (!isFinite(total) || total <= 0) return null;
    if (!VALID_CATEGORIES.has(cat)) return null;
    const gst = +(total / 11).toFixed(2);
    const amount = +(total - gst).toFixed(2);
    return {
        date: todayIso(),
        category: cat,
        description: desc,
        amount,
        gst,
        total,
        type: 'one-off',
    };
}

// ─── Supabase helpers ───────────────────────────────────────

function db() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

async function insertExpense(supabase, row) {
    const { data, error } = await supabase
        .from('expenses')
        .insert(row)
        .select('id, date, description, category, amount, gst, total')
        .single();
    if (error) throw error;
    return data;
}

async function recentExpenses(supabase, limit = 5) {
    const { data, error } = await supabase
        .from('expenses')
        .select('id, date, description, category, total, source')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function lastTelegramExpense(supabase, chatId) {
    const { data, error } = await supabase
        .from('expenses')
        .select('id, description, total')
        .like('source', 'telegram%')
        .eq('created_by', String(chatId))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function deleteExpense(supabase, id) {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
}

async function totals(supabase) {
    const today = todayIso();
    const month = monthKeyFor(today);
    const { data, error } = await supabase
        .from('expenses')
        .select('date, total')
        .gte('date', month + '-01');
    if (error) throw error;
    const monthTotal = (data || []).reduce((s, r) => s + Number(r.total || 0), 0);
    const todayTotal = (data || [])
        .filter(r => r.date === today)
        .reduce((s, r) => s + Number(r.total || 0), 0);
    return { today: todayTotal, month: monthTotal, count: (data || []).length };
}

// ─── Message handlers ───────────────────────────────────────

const HELP_TEXT =
`*MSS Expense Bot* — quick commands:

📸 *Send a photo* of any receipt → I'll extract & save it automatically.

✏️ *Or type:*
\`expense 47.50 supplies Bunnings concrete pour\`
\`expense 89 truck BP fuel Lara\`

Categories: \`rent\`, \`insurance\`, \`truck\`, \`designer\`, \`supplies\`, \`photography\`, \`software\`, \`other\`

🔧 *Other commands:*
\`last\` — show your last 5 expenses
\`total\` — today's & this month's totals
\`undo\` — remove the last one you added
\`help\` — this message`;

async function handlePhoto(update, supabase, token) {
    const msg = update.message;
    const chatId = msg.chat.id;
    // Pick the largest photo size
    const photos = msg.photo || [];
    const best = photos[photos.length - 1];
    if (!best) {
        await tgSend(token, chatId, '❌ No photo attached.');
        return;
    }

    await tgSend(token, chatId, '📸 Processing receipt…');

    let parsed;
    try {
        const fileUrl = await tgGetFileUrl(token, best.file_id);
        const { b64, bytes } = await downloadImageAsBase64(fileUrl);
        if (bytes > 5_000_000) {
            await tgSend(token, chatId, '⚠️ Image is over 5MB — please resend a smaller photo.');
            return;
        }
        parsed = await parseReceiptImage(b64);
    } catch (e) {
        console.error('[telegram-webhook] vision error:', e);
        await tgSend(token, chatId, '❌ Could not read receipt: ' + (e.message || 'unknown error'));
        return;
    }

    if (parsed.error === 'unreadable') {
        await tgSend(token, chatId,
            '❌ Receipt unreadable. Try a clearer photo, or send manually:\n`expense 47.50 supplies Bunnings X`');
        return;
    }

    const cat = VALID_CATEGORIES.has(parsed.category) ? parsed.category : 'other';
    const row = {
        date: parsed.date || todayIso(),
        description: (parsed.vendor ? parsed.vendor + ' — ' : '') + (parsed.description || 'Receipt'),
        category: cat,
        type: 'one-off',
        amount: Number(parsed.amount_ex_gst) || 0,
        gst: Number(parsed.gst) || 0,
        total: Number(parsed.total) || 0,
        source: 'telegram_photo',
        created_by: String(chatId),
        telegram_message_id: msg.message_id,
    };

    const saved = await insertExpense(supabase, row);
    const conf = parsed.confidence ? ` (${parsed.confidence} confidence)` : '';
    const reply =
`✅ *Added* ${conf}
*${saved.description}*
${fmtAud(saved.total)}  · ${saved.category}  · ${saved.date}

Reply \`undo\` to remove · \`total\` for today's spend`;
    await tgSend(token, chatId, reply);
}

async function handleText(update, supabase, token) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const raw = (msg.text || '').trim();
    const lower = raw.toLowerCase();

    // help / start
    if (lower === '/start' || lower === '/help' || lower === 'help' || lower === 'hi' || lower === 'hello') {
        await tgSend(token, chatId, HELP_TEXT);
        return;
    }

    // last
    if (lower === 'last' || lower === 'last 5' || lower === '/last') {
        const list = await recentExpenses(supabase, 5);
        if (!list.length) {
            await tgSend(token, chatId, 'No expenses yet. Send a receipt photo or type `help`.');
            return;
        }
        const lines = list.map(e => `• ${e.date} — ${fmtAud(e.total)} ${e.category} · ${e.description.slice(0, 50)}`);
        await tgSend(token, chatId, '*Last 5 expenses:*\n' + lines.join('\n'));
        return;
    }

    // total
    if (lower === 'total' || lower === '/total') {
        const t = await totals(supabase);
        await tgSend(token, chatId,
            `📊 *Spend so far*\nToday: ${fmtAud(t.today)}\nThis month: ${fmtAud(t.month)} (${t.count} entries)`);
        return;
    }

    // undo
    if (lower === 'undo' || lower === '/undo') {
        const last = await lastTelegramExpense(supabase, chatId);
        if (!last) {
            await tgSend(token, chatId, 'Nothing to undo.');
            return;
        }
        await deleteExpense(supabase, last.id);
        await tgSend(token, chatId, `↩️ Removed: ${last.description} (${fmtAud(last.total)})`);
        return;
    }

    // expense ... format
    const parsed = parseExpenseText(raw);
    if (parsed) {
        const row = {
            ...parsed,
            source: 'telegram_text',
            created_by: String(chatId),
            telegram_message_id: msg.message_id,
        };
        const saved = await insertExpense(supabase, row);
        await tgSend(token, chatId,
            `✅ *Added*\n*${saved.description}*\n${fmtAud(saved.total)}  · ${saved.category}  · ${saved.date}`);
        return;
    }

    // Fallback
    await tgSend(token, chatId,
        `❓ I didn't understand. Send a receipt photo, or type:\n\`expense 47.50 supplies Bunnings X\`\n\nType \`help\` for all commands.`);
}

// ─── Webhook entry ──────────────────────────────────────────

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    // Secret in URL query: /api/telegram-webhook?secret=XYZ
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const givenSecret = (req.query && req.query.secret) || '';
    if (!expectedSecret || givenSecret !== expectedSecret) {
        // 200 to discourage probing — log and ignore
        console.warn('[telegram-webhook] bad/missing secret');
        res.status(200).json({ ok: true });
        return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error('[telegram-webhook] TELEGRAM_BOT_TOKEN missing');
        res.status(200).json({ ok: true });
        return;
    }

    let update;
    try {
        update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
        res.status(200).json({ ok: true });
        return;
    }

    const msg = update && (update.message || update.edited_message);
    if (!msg) { res.status(200).json({ ok: true }); return; }

    const chatId = msg.chat && msg.chat.id;
    if (!ALLOWED_CHAT_IDS.has(chatId)) {
        // Quietly ignore — don't reveal the bot exists
        console.warn('[telegram-webhook] unauthorised chat_id:', chatId);
        res.status(200).json({ ok: true });
        return;
    }

    const supabase = db();

    try {
        if (msg.photo && msg.photo.length) {
            await handlePhoto(update, supabase, token);
        } else if (msg.text) {
            await handleText(update, supabase, token);
        } else {
            await tgSend(token, chatId, 'Send a receipt *photo* or type `help`.');
        }
    } catch (e) {
        console.error('[telegram-webhook] handler error:', e);
        try { await tgSend(token, chatId, '⚠️ Server error: ' + (e.message || 'unknown')); } catch (_) {}
    }

    res.status(200).json({ ok: true });
};
