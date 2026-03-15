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
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 40px; line-height: 1.6; }
          .header { border-bottom: 3px solid #008080; padding-bottom: 20px; margin-bottom: 40px; }
          .logo { color: #008080; font-size: 32px; font-weight: 800; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #f0fdf4; color: #166534; font-size: 12px; font-weight: 700; margin-top: 10px; }
          .meta-section { margin-bottom: 40px; }
          .meta-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
          .table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          .table th { background: #f8fafc; text-align: left; padding: 16px; border-bottom: 2px solid #e2e8f0; font-size: 13px; font-weight: 700; color: #475569; }
          .table td { padding: 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
          .summary-row { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
          .grand-total { border-top: 2px solid #008080; margin-top: 10px; padding-top: 15px; }
          .footer { margin-top: 80px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">SkillBridge</div>
          <div class="badge">PAID IN FULL</div>
          <div style="text-align: right; margin-top: -40px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #64748b; margin: 0;">TAX INVOICE</h1>
            <p style="margin: 5px 0; font-size: 14px;"><strong>INV-${invId}</strong></p>
            <p style="margin: 5px 0; font-size: 12px; color: #64748b;">Issued on: ${new Date(payment.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <div class="meta-section">
          <div class="meta-title">Billed To</div>
          <div style="font-weight: 700; font-size: 16px;">${user?.name || 'Customer'}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 4px;">${user?.email || ''}</div>
        </div>
        <table class="table">
          <thead><tr><th style="width:70%;">Description</th><th style="text-align:right;width:30%;">Amount</th></tr></thead>
          <tbody>
            <tr>
              <td><div style="font-weight: 700;">${desc}</div></td>
              <td style="text-align: right; font-weight: 700;">₹${Number(payment.amount || 0).toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>
        <div class="grand-total" style="text-align: right;">
          <span style="font-size: 18px; font-weight: 800; color: #008080;">Total: ₹${Number(payment.amount || 0).toLocaleString('en-IN')}</span>
        </div>
        <div class="footer">
          <p><strong>This is a computer generated document.</strong></p>
          <p>SkillBridge Marketplace | support@skillbridge.club</p>
        </div>
      </body>
      </html>
    `;
        return await PDFService.generatePDF(html);
    }

    /**
     * Generate Invoice for Tenant (Job/Escrow payment)
    async generateTenantInvoice(payment, job, user) {
        const jobId = job?._id ? job._id.toString().slice(-6).toUpperCase() : 'N/A';
        const jobTitle = job?.job_title || 'Service';
        const workerName = job?.selected_worker_id?.name || 'SkillBridge Verified Partner';
        const locationText = job?.location?.address_text || job?.location?.address || 'On-site Service';
        const invId = (payment.transactionId || 'N/A').slice(-8).toUpperCase();
        
        // Extract breakdown from gatewayResponse
        const breakdown = payment.gatewayResponse?.breakdown || {};
        const jobAmount = Number(breakdown.jobAmount || 0);
        const protectionFee = Number(breakdown.protectionFee || 0);
        const protectionTax = Number(breakdown.protectionTax || 0);
        const cgst = Number(breakdown.protectionCGST || (protectionTax / 2));
        const sgst = Number(breakdown.protectionSGST || (protectionTax / 2));
        const totalAmount = Number(payment.amount || 0);

        const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 40px; line-height: 1.6; }
          .header { border-bottom: 3px solid #008080; padding-bottom: 20px; margin-bottom: 40px; display: table; width: 100%; }
          .header-left { display: table-cell; vertical-align: top; }
          .header-right { display: table-cell; vertical-align: top; text-align: right; }
          .logo { color: #008080; font-size: 32px; font-weight: 800; letter-spacing: -1px; }
          .invoice-label { font-size: 24px; font-weight: 700; color: #64748b; margin: 0; }
          
          .meta-section { margin-bottom: 40px; display: table; width: 100%; }
          .meta-box { display: table-cell; width: 50%; vertical-align: top; }
          .meta-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
          
          .table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          .table th { background: #f8fafc; text-align: left; padding: 16px; border-bottom: 2px solid #e2e8f0; font-size: 13px; font-weight: 700; color: #475569; }
          .table td { padding: 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
          
          .summary-container { margin-top: 20px; display: table; width: 100%; }
          .summary-spacer { display: table-cell; width: 55%; }
          .summary-content { display: table-cell; width: 45%; }
          
          .summary-row { display: table; width: 100%; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
          .summary-label { display: table-cell; font-size: 14px; color: #64748b; }
          .summary-value { display: table-cell; text-align: right; font-weight: 600; }
          .grand-total { border-top: 2px solid #008080; margin-top: 10px; padding-top: 15px; border-bottom: none; }
          .total-label { font-size: 18px; font-weight: 800; color: #008080; }
          .total-value { font-size: 22px; font-weight: 800; color: #008080; }
          
          .footer { margin-top: 80px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #f0fdf4; color: #166534; font-size: 12px; font-weight: 700; margin-top: 10px; }
          .sac-code { font-size: 10px; color: #94a3b8; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-left">
            <div class="logo">SkillBridge</div>
            <div class="badge">PAID IN FULL</div>
          </div>
          <div class="header-right">
            <h1 class="invoice-label">TAX INVOICE</h1>
            <p style="margin: 5px 0; font-size: 14px;"><strong>INV-${invId}</strong></p>
            <p style="margin: 5px 0; font-size: 12px; color: #64748b;">Issued on: ${new Date(payment.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>

        <div class="meta-section">
          <div class="meta-box">
            <div class="meta-title">Billed To</div>
            <div style="font-weight: 700; font-size: 16px;">${user?.name || 'Customer'}</div>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
              ${user?.email || ''}<br>
              ${user?.phone || ''}
            </div>
          </div>
          <div class="meta-box">
            <div class="meta-title">Service Provider</div>
            <div style="font-weight: 700; font-size: 14px;">SkillBridge Technologies Private Limited</div>
            <div style="font-size: 11px; color: #475569; margin-top: 2px;">GSTIN: 29AABCU1234A1Z1</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">
              Partner: ${workerName}<br>
              Service Location: ${locationText}<br>
              Managed Marketplace Office: HSR Layout, Bengaluru, 560102
            </div>
          </div>
        </div>

        <table class="table">
          <thead>
            <tr>
              <th style="width: 70%;">Description of Service</th>
              <th style="text-align: right; width: 30%;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style="font-weight: 700;">Job Fulfillment: ${jobTitle}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 5px;">
                   Professional services for Job ID: ${jobId}. Includes on-site fulfillment and escrow security.
                </div>
                <div class="sac-code">SAC Code: 9987 - Maintenance and repair services</div>
              </td>
              <td style="text-align: right; font-weight: 700;">₹${jobAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td>
                <div style="font-weight: 700;">Platform Protection & Service Fee</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 5px;">
                   Escrow management, 7-day job protection, and verified worker fee.
                </div>
                <div class="sac-code">SAC Code: 9983 - Professional and Technical Services</div>
              </td>
              <td style="text-align: right; font-weight: 700;">₹${protectionFee.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>

        <div class="summary-container">
          <div class="summary-spacer"></div>
          <div class="summary-content">
            <div class="summary-row">
              <div class="summary-label">Subtotal (Excl. Tax)</div>
              <div class="summary-value">₹${(jobAmount + protectionFee).toLocaleString('en-IN')}</div>
            </div>
            <div class="summary-row">
              <div class="summary-label">CGST (9.0%)</div>
              <div class="summary-value">₹${cgst.toLocaleString('en-IN')}</div>
            </div>
            <div class="summary-row">
              <div class="summary-label">SGST (9.0%)</div>
              <div class="summary-value">₹${sgst.toLocaleString('en-IN')}</div>
            </div>
            <div class="summary-row grand-total">
                <div class="summary-label total-label">Total (Incl. Tax)</div>
                <div class="summary-value total-value">₹${totalAmount.toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>

        <div class="footer">
          <p><strong>This is a computer generated document. No signature required.</strong></p>
          <p>SkillBridge Marketplace | Automated Tax Invoicing System | support@skillbridge.club</p>
          <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} SkillBridge Technologies. Registered Office: Bengaluru, India.</p>
        </div>
      </body>
      </html>
    `;

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
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 40px; line-height: 1.6; }
          .header { border-bottom: 3px solid #64748b; padding-bottom: 20px; margin-bottom: 30px; display: table; width: 100%; }
          .header-left { display: table-cell; vertical-align: top; }
          .header-right { display: table-cell; vertical-align: top; text-align: right; }
          .logo { color: #008080; font-size: 32px; font-weight: 800; }
          .invoice-label { font-size: 24px; font-weight: 700; color: #64748b; margin: 0; }
          
          .meta-section { margin-bottom: 30px; display: table; width: 100%; }
          .meta-box { display: table-cell; width: 50%; vertical-align: top; }
          .meta-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
          
          .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          .table th { background: #f8fafc; text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 12px; font-weight: 700; color: #475569; }
          .table td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
          
          .summary-container { margin-top: 20px; display: table; width: 100%; }
          .summary-spacer { display: table-cell; width: 60%; }
          .summary-content { display: table-cell; width: 40%; }
          
          .summary-row { display: table; width: 100%; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
          .summary-label { display: table-cell; font-size: 13px; color: #64748b; }
          .summary-value { display: table-cell; text-align: right; font-weight: 600; }
          .grand-total { border-top: 2px solid #64748b; margin-top: 5px; padding-top: 10px; }
          
          .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 700; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-left">
            <div class="logo">SkillBridge</div>
            <div class="badge">SETTLEMENT INVOICE</div>
          </div>
          <div class="header-right">
            <h1 class="invoice-label">SETTLEMENT DETAIL</h1>
            <p style="margin: 5px 0; font-size: 13px;"><strong>INV-${invId}</strong></p>
            <p style="margin: 5px 0; font-size: 11px; color: #64748b;">Date: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>

        <div class="meta-section">
          <div class="meta-box">
            <div class="meta-title">Job Information</div>
            <div style="font-weight: 700; font-size: 14px;">${jobTitle}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Job ID: ${jobId}</div>
          </div>
          <div class="meta-box" style="text-align: right;">
            <div class="meta-title">Settlement Notes</div>
            <div style="font-size: 12px; color: #475569;">${settlementData.notes || 'Dispute resolved via mutually agreed settlement.'}</div>
          </div>
        </div>

        <table class="table">
          <thead>
            <tr>
              <th style="width: 70%;">Settlement Distribution</th>
              <th style="text-align: right; width: 30%;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Refund to Tenant (Escrow Return)</td>
              <td style="text-align: right;">₹${tenantRefund.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td>Payout to Worker (Service Completion)</td>
              <td style="text-align: right;">₹${workerPayout.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>

        <div class="summary-container">
          <div class="summary-spacer"></div>
          <div class="summary-content">
            <div class="summary-row">
              <div class="summary-label">Total Escrow Funds</div>
              <div class="summary-value">₹${totalEscrow.toLocaleString('en-IN')}</div>
            </div>
            <div class="summary-row grand-total">
                <div class="summary-label" style="font-weight: 800; color: #1e293b;">Settled Balance</div>
                <div class="summary-value" style="font-weight: 800; color: #1e293b;">₹0.00</div>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>This document serves as an official record of the financial settlement for the referenced job.</p>
          <p>SkillBridge Dispute Resolution Service | support@skillbridge.club</p>
        </div>
      </body>
      </html>
    `;

        return await PDFService.generatePDF(html);
    }
}

module.exports = new InvoiceService();
