const PDFService = require('../../common/services/pdf.service');
const logger = require('../../config/logger');

class InvoiceService {
    /**
     * Generate Invoice for Wallet Top-up or Payout (no job)
     */
    async generateSimpleInvoice(payment, user, description) {
        const desc = description || (payment.type === 'topup' ? 'Wallet Top-up' : payment.type === 'payout' ? 'Service Payout' : payment.type);
        const invId = (payment.transactionId || payment._id?.toString() || 'N/A').slice(-8).toUpperCase();
        const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 0; }
          :root { --p: #008080; --s: #1e293b; --t: #0f172a; --m: #64748b; --b: #e2e8f0; --a: #10b981; }
          body { font-family: 'Inter', sans-serif; color: var(--t); margin: 0; padding: 40px; line-height: 1.5; background: #fff; width: 210mm; min-height: 297mm; box-sizing: border-box; }
          .border-frame { position: fixed; top: 10mm; left: 10mm; right: 10mm; bottom: 10mm; border: 1px solid var(--b); pointer-events: none; z-index: -1; }
          .top-bar { position: fixed; top: 0; left: 0; width: 100%; height: 5mm; background: var(--p); }
          
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 50px; padding: 20px 0; border-bottom: 2px solid var(--p); }
          .logo-box h1 { margin: 0; font-size: 34px; font-weight: 800; color: var(--p); letter-spacing: -1.5px; }
          .logo-box span { font-size: 10px; font-weight: 700; color: var(--m); text-transform: uppercase; letter-spacing: 2px; }
          
          .doc-info { text-align: right; }
          .doc-info h2 { margin: 0; font-size: 28px; font-weight: 800; color: var(--s); }
          .ref-id { font-size: 13px; font-weight: 700; color: var(--p); margin-top: 5px; }

          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 60px; }
          .block h3 { font-size: 10px; font-weight: 800; color: var(--p); text-transform: uppercase; margin-bottom: 15px; border-bottom: 1px solid var(--b); padding-bottom: 5px; }
          .block div { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
          .block b { font-size: 16px; font-weight: 700; color: var(--s); display: block; margin-bottom: 8px; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
          th { background: var(--s); color: #fff; text-align: left; padding: 14px 18px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          td { padding: 20px 18px; border-bottom: 1px solid var(--b); font-size: 14px; vertical-align: top; }
          
          .total-section { display: flex; justify-content: flex-end; }
          .total-card { width: 280px; padding: 25px; background: var(--s); color: #fff; border-radius: 12px; }
          .total-row { display: flex; justify-content: space-between; align-items: center; }
          .total-label { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
          .total-val { font-size: 28px; font-weight: 800; color: var(--a); }

          .footer { position: absolute; bottom: 40px; left: 40px; right: 40px; border-top: 2px solid var(--p); padding-top: 25px; text-align: center; }
          .footer p { margin: 4px 0; font-size: 11px; color: var(--m); }
          .rupee { font-family: 'Inter', Arial, sans-serif; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="top-bar"></div>
        <div class="border-frame"></div>
        <div class="header">
          <div class="logo-box">
            <h1>SkillBridge</h1>
            <span>Managed Professional Ecosystem</span>
          </div>
          <div class="doc-info">
            <h2>OFFICIAL RECEIPT</h2>
            <div class="ref-id">REF: #SKB-${invId}</div>
            <div style="font-size: 12px; color: var(--m); margin-top: 5px;">${new Date(payment.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>

        <div class="grid">
          <div class="block">
            <h3>Recipient Details</h3>
            <b>${user?.name || 'Valued User'}</b>
            <div>${user?.email || 'N/A'}</div>
            <div>${user?.phone || 'Account Verified'}</div>
          </div>
          <div class="block">
            <h3>Supplier Information</h3>
            <b>SkillBridge Technologies Pvt Ltd</b>
            <div>GSTIN: 29AABCU1234A1Z1</div>
            <div>support@skillbridge.club</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 70%">Transaction Item Description</th>
              <th style="width: 30%; text-align: right;">Amount (\u20B9)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style="font-weight: 700; font-size: 16px; margin-bottom: 5px; color: var(--s);">${desc}</div>
                <div style="font-size: 11px; color: var(--m);">Digitally verified transaction processed through SkillBridge Secure Infrastructure.</div>
              </td>
              <td style="text-align: right; font-weight: 800; font-size: 18px; color: var(--s);">
                <span class="rupee">₹</span>${Number(payment.amount || 0).toLocaleString('en-IN')}
              </td>
            </tr>
          </tbody>
        </table>

        <div class="total-section">
          <div class="total-card">
            <div class="total-row">
              <span class="total-label">Grand Total</span>
              <span class="total-val"><span class="rupee">₹</span>${Number(payment.amount || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <p><strong>SkillBridge Marketplace | Secure Payment Confirmation</strong></p>
          <p>Registered Office: Tech Park Building, Bangalore, Karnataka - 560102</p>
          <p>This document is legally valid without a signature under the IT Act 2000.</p>
        </div>
      </body>
      </html>
    `;
        return await PDFService.generatePDF(html);
    }

    /**
     * Generate Invoice for Tenant (Job/Escrow payment)
     */
    async generateTenantInvoice(payment, job, user) {
        const jobId = job?._id ? job._id.toString().slice(-6).toUpperCase() : 'N/A';
        const jobTitle = job?.job_title || 'Service Execution';
        const workerName = job?.selected_worker_id?.name || 'Verified Partner';
        const locationText = job?.location?.address_text || job?.location?.address || 'Site-based';
        const invId = (payment.transactionId || payment._id.toString()).slice(-8).toUpperCase();
        
        const breakdown = payment.gatewayResponse?.breakdown || {};
        const jobAmount = Number(breakdown.jobAmount || (payment.amount * 0.9));
        const protectionFee = Number(breakdown.protectionFee || (payment.amount * 0.1));
        const totalAmount = Number(payment.amount || 0);

        const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 0; }
          :root { --p: #008080; --s: #1e293b; --t: #0f172a; --m: #64748b; --b: #e2e8f0; --a: #10b981; }
          body { font-family: 'Inter', sans-serif; color: var(--t); margin: 0; padding: 40px; background: #fff; width: 210mm; min-height: 297mm; box-sizing: border-box; }
          .border-frame { position: fixed; top: 10mm; left: 10mm; right: 10mm; bottom: 10mm; border: 1px solid var(--b); pointer-events: none; z-index: -1; }
          .top-bar { position: fixed; top: 0; left: 0; width: 100%; height: 5mm; background: var(--p); }
          
          .header { display: flex; justify-content: space-between; align-items: centre; margin-bottom: 50px; padding: 20px 0; border-bottom: 3px solid var(--p); }
          .logo-area h1 { margin: 0; font-size: 38px; font-weight: 900; color: var(--p); letter-spacing: -2px; }
          .logo-area span { font-size: 11px; font-weight: 700; color: var(--m); text-transform: uppercase; letter-spacing: 3px; }
          
          .meta-area { text-align: right; }
          .meta-area h2 { margin: 0; font-size: 30px; font-weight: 800; color: var(--s); }
          .meta-info { margin-top: 8px; font-size: 13px; color: var(--m); font-weight: 600; }
          .meta-info b { color: var(--p); }

          .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 50px; }
          .party-card { padding: 25px; background: #f8fafc; border-radius: 12px; border: 1px solid var(--b); }
          .label { font-size: 10px; font-weight: 800; color: var(--p); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 1px; }
          .name { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: var(--s); }
          .info { font-size: 12px; color: var(--m); line-height: 1.6; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 40px; border-radius: 10px; overflow: hidden; }
          th { background: var(--s); color: #fff; text-align: left; padding: 15px 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          td { padding: 22px 20px; border-bottom: 1px solid var(--b); font-size: 14px; vertical-align: top; }
          .item-bold { font-weight: 700; color: var(--s); font-size: 16px; margin-bottom: 5px; }
          .item-sub { font-size: 11px; color: var(--m); line-height: 1.5; }
          .sac-badge { display: inline-block; padding: 4px 10px; background: #e0f2f1; color: #00796b; border-radius: 6px; font-size: 10px; font-weight: 800; margin-top: 10px; text-transform: uppercase; }

          .summary-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 40px; }
          .notice-box { font-size: 11px; color: var(--m); line-height: 1.7; }
          .notice-box h4 { color: var(--p); margin: 0 0 10px; font-size: 12px; text-transform: uppercase; }
          
          .totals-card { padding: 30px; background: var(--s); color: #fff; border-radius: 15px; }
          .tot-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding: 10px 0; }
          .tot-row:last-child { border: none; margin-top: 15px; padding-top: 15px; }
          .grand-label { font-weight: 800; font-size: 16px; color: #94a3b8; }
          .grand-val { font-weight: 900; font-size: 32px; color: var(--a); }

          .footer { position: absolute; bottom: 40px; left: 40px; right: 40px; text-align: center; border-top: 2px solid var(--p); padding-top: 25px; }
          .footer p { font-size: 10px; color: var(--m); margin: 5px 0; }
          .rupee { font-family: 'Inter', Arial, sans-serif; }
        </style>
      </head>
      <body>
        <div class="top-bar"></div>
        <div class="border-frame"></div>
        <div class="header">
          <div class="logo-area">
            <h1>SkillBridge</h1>
            <span>Elite Managed Marketplace</span>
          </div>
          <div class="meta-area">
            <h2>TAX INVOICE</h2>
            <div class="meta-info">Document #: <b>${invId}</b></div>
            <div class="meta-info">Date: ${new Date(payment.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>

        <div class="parties">
          <div class="party-card">
            <div class="label">Recipient Details</div>
            <div class="name">${user?.name || 'Valued Customer'}</div>
            <div class="info">
              Account ID: ${user?.email || 'N/A'}<br>
              Phone: ${user?.phone || 'Identity Verified'}<br>
              Status: Active Member
            </div>
          </div>
          <div class="party-card">
            <div class="label">Marketplace Supplier</div>
            <div class="name">SkillBridge Technologies</div>
            <div class="info">
              GSTIN: 29AABCU1234A1Z1<br>
              Execution Partner: ${workerName}<br>
              Service Type: ${locationText}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 70%">Items for Professional Fulfillment</th>
              <th style="width: 30%; text-align: right;">Net Amount (\u20B9)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="item-bold">Service Component: ${jobTitle}</div>
                <div class="item-sub">Unified fulfillment for Job ID [${jobId}]. Professional verification and milestone management active.</div>
                <div class="sac-badge">SAC: 9987 (Maintenance Services)</div>
              </td>
              <td style="text-align: right; font-weight: 800; font-size: 18px; color: var(--s);">
                <span class="rupee">₹</span>${jobAmount.toLocaleString('en-IN')}
              </td>
            </tr>
            <tr>
              <td>
                <div class="item-bold">Security, Escrow & Warranty Fee</div>
                <div class="item-sub">Statutory platform protection, 7-day workmanship warranty, and dispute mediation.</div>
                <div class="sac-badge">SAC: 9983 (Professional Services)</div>
              </td>
              <td style="text-align: right; font-weight: 800; font-size: 18px; color: var(--s);">
                <span class="rupee">₹</span>${protectionFee.toLocaleString('en-IN')}
              </td>
            </tr>
          </tbody>
        </table>

        <div class="summary-grid">
          <div class="notice-box">
            <h4>Filing Notice</h4>
            1. All payments are secured via SkillBridge Escrow protocols.<br>
            2. 18% GST integrated into platform service billing components.<br>
            3. This receipt acts as proof of professional fulfillment.<br>
            4. Generated via SkillBridge Automated Compliance Engine.
          </div>
          <div class="totals-card">
            <div class="tot-row">
              <span style="color: #94a3b8;">Taxable Subtotal</span>
              <span style="font-weight: 700;">₹${(jobAmount + protectionFee).toLocaleString('en-IN')}</span>
            </div>
            <div class="tot-row">
              <span style="color: #94a3b8;">Integrated Taxes</span>
              <span style="font-weight: 700;">₹0.00</span>
            </div>
            <div class="tot-row">
              <span class="grand-label">GRAND TOTAL</span>
              <span class="grand-val"><span class="rupee">₹</span>${totalAmount.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <p><strong>This document is electronically verified by SkillBridge Technologies Private Limited.</strong></p>
          <p>Registered Office: Bangalore Tech Hub, Karnataka, 560102. support@skillbridge.club</p>
          <p>No physical signature required for computer-generated documents under the IT Act 2000.</p>
        </div>
      </body>
      </html>
    `;

        return await PDFService.generatePDF(html);
    }

    /**
     * Generate Invoice for Dispute Settlement
     */
    async generateSettlementInvoice(job, settlementData, user) {
        const jobId = job?._id ? job._id.toString().slice(-6).toUpperCase() : 'N/A';
        const jobTitle = job?.job_title || 'Settled Service';
        const invId = `SET-${Date.now().toString().slice(-6)}`;
        
        const tenantRefund = Number(settlementData.tenantAmount || 0);
        const workerPayout = Number(settlementData.workerAmount || 0);
        const totalEscrow = tenantRefund + workerPayout;

        const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page { size: A4; margin: 0; }
          :root { --p: #008080; --s: #1e293b; --t: #0f172a; --m: #64748b; --b: #e2e8f0; --a: #10b981; }
          body { font-family: 'Inter', sans-serif; color: var(--t); margin: 0; padding: 40px; background: #fff; width: 210mm; min-height: 297mm; box-sizing: border-box; }
          .border-frame { position: fixed; top: 10mm; left: 10mm; right: 10mm; bottom: 10mm; border: 2px solid var(--b); pointer-events: none; z-index: -1; border-radius: 12px; }
          
          .header { display: flex; justify-content: space-between; border-bottom: 4px solid var(--p); padding-bottom: 30px; margin-bottom: 40px; padding-top: 20px; }
          .logo { font-size: 34px; font-weight: 800; color: var(--p); letter-spacing: -1.5px; }
          .settled-badge { border: 2px solid #f59e0b; color: #f59e0b; padding: 5px 15px; font-size: 11px; font-weight: 800; border-radius: 8px; text-transform: uppercase; margin-top: 15px; display: inline-block; }
          
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 50px; padding: 30px; background: #f8fafc; border-radius: 15px; border: 1px solid var(--b); }
          .label { font-size: 10px; font-weight: 800; color: var(--p); text-transform: uppercase; margin-bottom: 6px; }
          .val { font-size: 16px; font-weight: 700; color: var(--s); }

          .note-area { margin-bottom: 40px; padding: 25px; border-left: 6px solid #f59e0b; background: #fffbeb; border-radius: 8px; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 40px; border-radius: 10px; overflow: hidden; }
          th { background: var(--s); color: #fff; text-align: left; padding: 15px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          td { padding: 20px 15px; border-bottom: 1px solid var(--b); font-size: 15px; color: var(--s); }
          
          .summary { display: flex; justify-content: flex-end; }
          .sum-final { width: 300px; padding: 25px; background: var(--s); color: #fff; border-radius: 12px; }
          .sum-row { display: flex; justify-content: space-between; font-weight: 800; font-size: 18px; }
          .final-val { color: var(--a); }

          .footer { position: absolute; bottom: 40px; left: 40px; right: 40px; text-align: center; font-size: 11px; color: var(--m); border-top: 1px solid var(--p); padding-top: 20px; }
          .rupee { font-family: 'Inter', Arial, sans-serif; }
        </style>
      </head>
      <body>
        <div class="border-frame"></div>
        <div class="header">
          <div>
            <div class="logo">SkillBridge</div>
            <div style="font-size: 11px; font-weight: 700; color: var(--m); letter-spacing: 1px;">ARBITRATION & SETTLEMENT BOARD</div>
            <div class="settled-badge">Final Settlement Document</div>
          </div>
          <div style="text-align: right;">
            <h1 style="margin: 0; font-size: 32px; font-weight: 800; color: var(--s);">SETTLEMENT</h1>
            <div style="margin-top: 10px; font-weight: 800; color: var(--p); font-size: 14px;">REF ID: #SET-${invId}</div>
            <div style="font-size: 12px; color: var(--m); margin-top: 4px;">Verified Date: ${new Date().toLocaleDateString('en-IN', {day: 'numeric', month: 'long', year: 'numeric'})}</div>
          </div>
        </div>

        <div class="grid">
          <div>
            <div class="label">Governing Authority</div>
            <div class="val">SkillBridge Technologies Private Limited</div>
          </div>
          <div style="text-align: right;">
            <div class="label">Resolved Service Asset</div>
            <div class="val">${jobTitle} [${jobId}]</div>
          </div>
        </div>

        <div class="note-area">
          <div class="label" style="color: #b45309;">RESOLUTION PROTOCOL NOTICE</div>
          <div style="font-size: 14px; font-weight: 500; color: #78350f; margin-top: 10px;">
            Disbursement processed under SkillBridge Marketplace Resolution Framework. 
            All funds have been distributed to the respective wallets of the originating parties.
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>DISTRIBUTION CHANNEL</th>
              <th style="text-align: right;">AMOUNT (\u20B9)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Escrow Refund to Origin (Tenant)</td>
              <td style="text-align: right; font-weight: 800;"><span class="rupee">₹</span>${tenantRefund.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td>Escrow Payout to Execution Partner (Worker)</td>
              <td style="text-align: right; font-weight: 700;"><span class="rupee">₹</span>${workerPayout.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>

        <div class="summary">
          <div class="sum-final">
            <div class="sum-row">
              <span style="opacity: 0.8; font-size: 12px; text-transform: uppercase;">Total Settlement</span>
              <span class="final-val"><span class="rupee">₹</span>${totalEscrow.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} SkillBridge Marketplace | Official Resolution Record</p>
          <p>Technologically verified settlement certificate protected by marketplace governance protocols.</p>
        </div>
      </body>
      </html>
    `;

        return await PDFService.generatePDF(html);
    }
}

module.exports = new InvoiceService();
