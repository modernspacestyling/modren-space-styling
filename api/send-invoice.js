/**
 * /api/send-invoice.js — Auto-generate and email invoice to customer
 *
 * Called automatically after booking creation, or manually from admin.
 * Generates a professional HTML invoice with logo and ABN.
 * Payment terms: 6 weeks from install date.
 *
 * POST body: { type: 'staging'|'photo', jobNumber, ... booking fields }
 * Returns: { success: true, invoiceNumber }
 */

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// ── Invoice number generator ──
async function generateInvoiceNumber(supabase, type) {
    const prefix = type === 'photo' ? 'INV-P' : 'INV-S';
    const year = new Date().getFullYear();
    // Count existing invoices to generate sequence
    const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .like('invoice_number', `${prefix}-${year}%`);
    const seq = String((count || 0) + 1).padStart(4, '0');
    return `${prefix}-${year}-${seq}`;
}

// ── Format currency ──
function fmtCurrency(amount) {
    return new Intl.NumberFormat('en-AU', {
        style: 'currency', currency: 'AUD',
    }).format(amount);
}

// ── Format date ──
function fmtDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
        day: '2-digit', month: 'long', year: 'numeric',
    });
}

// ── GST calculation ──
function calculateGST(total) {
    const gst = total / 11; // GST is included in total (1/11th)
    const exGst = total - gst;
    return { exGst: Math.round(exGst * 100) / 100, gst: Math.round(gst * 100) / 100, total };
}

// ── Generate HTML Invoice ──
function generateInvoiceHTML(data) {
    const { invoiceNumber, jobNumber, type, customerName, customerEmail,
        customerPhone, agency, address, serviceDate, dueDate, lineItems,
        subtotal, gst, total, notes } = data;

    const itemRows = lineItems.map(item => `
        <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0ece4; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333;">${item.description}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0ece4; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; text-align: center;">${item.qty}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0ece4; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; text-align: right;">${fmtCurrency(item.unitPrice)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0ece4; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; text-align: right; font-weight: 500;">${fmtCurrency(item.amount)}</td>
        </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f5f2ed; font-family: 'Helvetica Neue', Arial, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f2ed; padding: 40px 20px;">
<tr><td align="center">
<table width="650" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

<!-- Header with logo -->
<tr>
<td style="background-color: #1C1C1C; padding: 30px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td>
            <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: 1px;">Modern Space Styling</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #B8963E; letter-spacing: 3px; margin-top: 4px; text-transform: uppercase;">Property Staging &middot; Geelong VIC</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9px; color: #888; letter-spacing: 1px; margin-top: 2px;">PTY LTD</div>
        </td>
        <td style="text-align: right; vertical-align: top;">
            <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 28px; color: #B8963E; font-weight: 600;">INVOICE</div>
        </td>
    </tr>
    </table>
</td>
</tr>

<!-- Invoice details bar -->
<tr>
<td style="background-color: #B8963E; padding: 16px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #fff;">
            <strong>Invoice:</strong> ${invoiceNumber}
        </td>
        <td style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #fff; text-align: center;">
            <strong>Job:</strong> ${jobNumber}
        </td>
        <td style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #fff; text-align: right;">
            <strong>Date:</strong> ${fmtDate(new Date().toISOString())}
        </td>
    </tr>
    </table>
</td>
</tr>

<!-- From / To section -->
<tr>
<td style="padding: 30px 40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td style="vertical-align: top; width: 50%;">
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; font-weight: 600;">From</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
                <strong>Modern Space Styling Pty Ltd</strong><br>
                ABN: 75 685 915 495<br>
                Geelong, VIC 3220<br>
                info@modernspacestyling.com.au<br>
                www.modernspacestyling.com.au
            </div>
        </td>
        <td style="vertical-align: top; width: 50%;">
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; font-weight: 600;">Bill To</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
                <strong>${customerName}</strong><br>
                ${agency ? agency + '<br>' : ''}
                ${customerEmail}<br>
                ${customerPhone}
            </div>
        </td>
    </tr>
    </table>
</td>
</tr>

<!-- Property & dates -->
<tr>
<td style="padding: 0 40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #faf8f4; border-radius: 6px; padding: 16px;">
    <tr>
        <td style="padding: 12px 16px;">
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Property</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; margin-top: 4px;">${address}</div>
        </td>
        <td style="padding: 12px 16px;">
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Service Date</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; margin-top: 4px;">${fmtDate(serviceDate)}</div>
        </td>
        <td style="padding: 12px 16px;">
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Payment Due</div>
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #cc3300; font-weight: 600; margin-top: 4px;">${fmtDate(dueDate)}</div>
        </td>
    </tr>
    </table>
</td>
</tr>

<!-- Line items table -->
<tr>
<td style="padding: 0 40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
    <thead>
        <tr style="background-color: #1C1C1C;">
            <th style="padding: 12px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #B8963E; text-transform: uppercase; letter-spacing: 1px; text-align: left; font-weight: 600;">Description</th>
            <th style="padding: 12px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #B8963E; text-transform: uppercase; letter-spacing: 1px; text-align: center; font-weight: 600;">Qty</th>
            <th style="padding: 12px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #B8963E; text-transform: uppercase; letter-spacing: 1px; text-align: right; font-weight: 600;">Unit Price</th>
            <th style="padding: 12px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #B8963E; text-transform: uppercase; letter-spacing: 1px; text-align: right; font-weight: 600;">Amount</th>
        </tr>
    </thead>
    <tbody>
        ${itemRows}
    </tbody>
    </table>
</td>
</tr>

<!-- Totals -->
<tr>
<td style="padding: 0 40px 30px;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td style="width: 55%;"></td>
        <td style="width: 45%;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
                <td style="padding: 8px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #666;">Subtotal (ex GST)</td>
                <td style="padding: 8px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; text-align: right;">${fmtCurrency(subtotal)}</td>
            </tr>
            <tr>
                <td style="padding: 8px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #666;">GST (10%)</td>
                <td style="padding: 8px 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; color: #333; text-align: right;">${fmtCurrency(gst)}</td>
            </tr>
            <tr>
                <td style="padding: 12px 16px; font-family: Georgia, 'Times New Roman', serif; font-size: 20px; color: #1C1C1C; font-weight: 700; border-top: 2px solid #B8963E;">Total (inc GST)</td>
                <td style="padding: 12px 16px; font-family: Georgia, 'Times New Roman', serif; font-size: 20px; color: #B8963E; font-weight: 700; text-align: right; border-top: 2px solid #B8963E;">${fmtCurrency(total)}</td>
            </tr>
            </table>
        </td>
    </tr>
    </table>
</td>
</tr>

<!-- Payment terms -->
<tr>
<td style="padding: 0 40px 30px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #faf8f4; border-radius: 6px; border-left: 4px solid #B8963E;">
    <tr>
    <td style="padding: 20px;">
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; margin-bottom: 8px;">Payment Terms</div>
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #555; line-height: 1.6;">
            Payment is due within <strong>6 weeks</strong> from the service date (by <strong>${fmtDate(dueDate)}</strong>).<br>
            Please make payment via bank transfer to:<br><br>
            <strong>Modern Space Styling Pty Ltd</strong><br>
            BSB: <strong>013-642</strong><br>
            Account: <strong>809476118</strong><br>
            Reference: <strong>${invoiceNumber}</strong><br><br>
            For questions about this invoice, please contact us at<br>
            info@modernspacestyling.com.au or reply to this email.
        </div>
    </td>
    </tr>
    </table>
</td>
</tr>

${notes ? `
<!-- Notes -->
<tr>
<td style="padding: 0 40px 30px;">
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #B8963E; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; margin-bottom: 8px;">Notes</div>
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #666;">${notes}</div>
</td>
</tr>
` : ''}

<!-- Footer -->
<tr>
<td style="background-color: #1C1C1C; padding: 24px 40px; text-align: center;">
    <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; color: #B8963E; letter-spacing: 1px;">Modern Space Styling Pty Ltd</div>
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #888; margin-top: 6px;">ABN: 75 685 915 495 &middot; Geelong, VIC &middot; www.modernspacestyling.com.au</div>
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; color: #666; margin-top: 8px;">Thank you for choosing Modern Space Styling</div>
</td>
</tr>

</table>
</td></tr></table>
</body>
</html>`;
}

// ── Build line items for staging booking ──
function buildStagingLineItems(booking, pricingConfig) {
    const c = pricingConfig || {};
    const items = [];

    items.push({
        description: 'Property Staging — Base Package (6 weeks)',
        qty: 1, unitPrice: c.base_price || 800,
        amount: c.base_price || 800,
    });

    const beds = parseInt(booking.bedrooms) || 0;
    if (beds > 0) {
        const rate = c.bedroom_rate || 250;
        items.push({ description: `Bedroom Staging (${beds} bedroom${beds > 1 ? 's' : ''})`, qty: beds, unitPrice: rate, amount: beds * rate });
    }

    const masterBeds = parseInt(booking.master_bedrooms || booking.masterBedrooms) || 0;
    if (masterBeds > 0) {
        const rate = c.master_bedroom_rate || 300;
        items.push({ description: `Master Bedroom Staging (${masterBeds})`, qty: masterBeds, unitPrice: rate, amount: masterBeds * rate });
    }

    const baths = parseInt(booking.bathrooms) || 0;
    if (baths > 0) {
        const rate = c.bathroom_rate || 150;
        items.push({ description: `Bathroom Styling (${baths} bathroom${baths > 1 ? 's' : ''})`, qty: baths, unitPrice: rate, amount: baths * rate });
    }

    const living = parseInt(booking.living_areas || booking.livingAreas) || 0;
    if (living > 0) {
        const rate = c.living_rate || 250;
        items.push({ description: `Living Area Staging (${living} area${living > 1 ? 's' : ''})`, qty: living, unitPrice: rate, amount: living * rate });
    }

    const dining = parseInt(booking.dining_areas || booking.diningAreas) || 0;
    if (dining > 0) {
        const rate = c.dining_rate || 150;
        items.push({ description: `Dining Area Staging (${dining} area${dining > 1 ? 's' : ''})`, qty: dining, unitPrice: rate, amount: dining * rate });
    }

    if (booking.alfresco) {
        const rate = c.alfresco_rate || 200;
        items.push({ description: 'Alfresco Styling', qty: 1, unitPrice: rate, amount: rate });
    }

    if (booking.pantry) {
        const rate = c.pantry_rate || 100;
        items.push({ description: 'Walk-in Pantry Styling', qty: 1, unitPrice: rate, amount: rate });
    }

    if (booking.hallway) {
        items.push({ description: 'Hallway Styling (complimentary)', qty: 1, unitPrice: 0, amount: 0 });
    }

    if (!booking.vacant) {
        items.push({ description: 'Occupied Property Surcharge', qty: 1, unitPrice: c.occupied_surcharge || 300, amount: c.occupied_surcharge || 300 });
    }

    if (booking.travel_surcharge || booking.travelSurcharge) {
        items.push({ description: 'Travel Surcharge (100km+)', qty: 1, unitPrice: c.travel_surcharge || 50, amount: c.travel_surcharge || 50 });
    }

    return items;
}

// ── Build line items for photo booking ──
function buildPhotoLineItems(booking) {
    const PACKAGES = {
        essential: { name: 'Essential Photography Package', price: 349 },
        premium: { name: 'Premium Photography Package', price: 449 },
        ultimate: { name: 'Ultimate Photography Package', price: 599 },
        rental: { name: 'Rental Photography Package (12 photos)', price: 196.90 },
    };
    const items = [];
    const pkg = PACKAGES[booking.package] || PACKAGES.essential;
    items.push({ description: pkg.name, qty: 1, unitPrice: pkg.price, amount: pkg.price });

    const addons = Array.isArray(booking.addons) ? booking.addons : [];
    addons.forEach(addon => {
        if (addon.key === 'twilight') {
            items.push({ description: 'Twilight Photography Add-on', qty: 1, unitPrice: 150, amount: 150 });
        } else if (addon.key === 'drone') {
            items.push({ description: 'Drone Aerial Photography Add-on', qty: 1, unitPrice: 200, amount: 200 });
        } else if (addon.key === 'virtual_staging') {
            const rooms = parseInt(addon.rooms) || 1;
            items.push({ description: `Virtual Staging (${rooms} room${rooms > 1 ? 's' : ''})`, qty: rooms, unitPrice: 100, amount: 100 * rooms });
        }
    });

    return items;
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { type, jobNumber, booking, pricingConfig } = req.body;

    if (!type || !jobNumber || !booking) {
        return res.status(400).json({ error: 'Missing required fields: type, jobNumber, booking' });
    }

    // ── Supabase ──
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── Build line items ──
    let lineItems;
    let customerName, customerEmail, customerPhone, agency, address, serviceDate;

    if (type === 'staging') {
        lineItems = buildStagingLineItems(booking, pricingConfig);
        customerName = booking.agent_name || booking.agentName;
        customerEmail = booking.agent_email || booking.agentEmail;
        customerPhone = booking.agent_phone || booking.agentPhone;
        agency = booking.agency;
        address = booking.address;
        serviceDate = booking.install_date || booking.installDate;
    } else {
        lineItems = buildPhotoLineItems(booking);
        customerName = booking.client_name || booking.clientName;
        customerEmail = booking.client_email || booking.clientEmail;
        customerPhone = booking.client_phone || booking.clientPhone;
        agency = booking.agency;
        address = booking.address;
        serviceDate = booking.preferred_date || booking.preferredDate;
    }

    // ── Calculate totals ──
    const totalIncGst = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const { exGst, gst, total } = calculateGST(totalIncGst);

    // ── Due date: 6 weeks from service date ──
    const serviceDateObj = new Date(serviceDate);
    const dueDateObj = new Date(serviceDateObj);
    dueDateObj.setDate(dueDateObj.getDate() + 42); // 6 weeks
    const dueDate = dueDateObj.toISOString().slice(0, 10);

    // ── Generate invoice number ──
    const invoiceNumber = await generateInvoiceNumber(supabase, type);

    // ── Save invoice to DB ──
    const { error: insertErr } = await supabase
        .from('invoices')
        .insert({
            invoice_number: invoiceNumber,
            job_number: jobNumber,
            type,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            agency: agency || null,
            address,
            service_date: serviceDate,
            due_date: dueDate,
            line_items: lineItems,
            subtotal_ex_gst: exGst,
            gst_amount: gst,
            total_inc_gst: total,
            payment_status: 'pending',
            created_at: new Date().toISOString(),
        });

    if (insertErr) {
        console.error('[send-invoice] DB insert failed:', insertErr);
        // Don't fail the whole flow — still try to send email
    }

    // ── Generate invoice HTML ──
    const invoiceHTML = generateInvoiceHTML({
        invoiceNumber, jobNumber, type,
        customerName, customerEmail, customerPhone,
        agency, address, serviceDate, dueDate,
        lineItems, subtotal: exGst, gst, total,
        notes: booking.notes || '',
    });

    // ── Send email via Resend ──
    if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        try {
            const { data: emailData, error: emailErr } = await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'Modern Space Styling <invoices@modernspacestyling.com.au>',
                to: [customerEmail],
                subject: `Invoice ${invoiceNumber} — Modern Space Styling`,
                html: invoiceHTML,
                replyTo: 'info@modernspacestyling.com.au',
            });

            if (emailErr) {
                console.error('[send-invoice] Email failed:', emailErr);
            } else {
                // Update invoice with email status
                await supabase.from('invoices')
                    .update({ email_sent: true, email_sent_at: new Date().toISOString() })
                    .eq('invoice_number', invoiceNumber);

                // Log activity
                await supabase.from('activity_log').insert({
                    message: `Invoice ${invoiceNumber} emailed to ${customerEmail} for ${jobNumber} — ${fmtCurrency(total)}`,
                    actor: 'system',
                });
            }
        } catch (err) {
            console.error('[send-invoice] Email send error:', err.message);
        }
    } else {
        console.warn('[send-invoice] RESEND_API_KEY not set — invoice saved but not emailed');
    }

    return res.status(200).json({
        success: true,
        invoiceNumber,
        total,
        dueDate,
        emailSent: !!process.env.RESEND_API_KEY,
    });
};
