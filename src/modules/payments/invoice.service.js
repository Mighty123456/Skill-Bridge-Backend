const PDFService = require('../../common/services/pdf.service');
const logger = require('../../config/logger');

class InvoiceService {
    /**
     * Generate Invoice for Tenant
     */
    async generateTenantInvoice(payment, job, user) {
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
          .summary-spacer { display: table-cell; width: 60%; }
          .summary-content { display: table-cell; width: 40%; }
          
          .summary-row { display: table; width: 100%; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
          .summary-label { display: table-cell; font-size: 14px; color: #64748b; }
          .summary-value { display: table-cell; text-align: right; font-weight: 600; }
          .grand-total { border-top: 2px solid #008080; margin-top: 10px; padding-top: 15px; border-bottom: none; }
          .total-label { font-size: 18px; font-weight: 800; color: #008080; }
          .total-value { font-size: 22px; font-weight: 800; color: #008080; }
          
          .footer { margin-top: 80px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #f0fdf4; color: #166534; font-size: 12px; font-weight: 700; margin-top: 10px; }
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
            <p style="margin: 5px 0; font-size: 14px;"><strong>INV-${payment.transactionId.slice(-8).toUpperCase()}</strong></p>
            <p style="margin: 5px 0; font-size: 12px; color: #64748b;">Issued on: ${new Date(payment.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>

        <div class="meta-section">
          <div class="meta-box">
            <div class="meta-title">Billed To</div>
            <div style="font-weight: 700; font-size: 16px;">${user.name}</div>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
              ${user.email}<br>
              ${user.phone || ''}
            </div>
          </div>
          <div class="meta-box">
            <div class="meta-title">Service Provider</div>
            <div style="font-weight: 700; font-size: 14px;">${job.selected_worker_id?.name || 'SkillBridge Verified Partner'}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Service Location: ${job.location?.address || 'On-site Service'}
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
                <div style="font-weight: 700;">Job ID: ${job._id.toString().slice(-6).toUpperCase()} - ${job.job_title}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 5px;">
                   Includes platform protection, worker fulfillment, and escrow security for the job duration.
                </div>
              </td>
              <td style="text-align: right; font-weight: 700;">₹${payment.amount.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>

        <div class="summary-container">
          <div class="summary-spacer"></div>
          <div class="summary-content">
            <div class="summary-row">
              <div class="summary-label">Subtotal</div>
              <div class="summary-value">₹${payment.amount.toLocaleString('en-IN')}</div>
            </div>
            <div class="summary-row">
              <div class="summary-label">Tax (Inclusive)</div>
              <div class="summary-value">₹0.00</div>
            </div>
            <div class="summary-row grand-total">
                <div class="summary-label total-label">Total Amount</div>
                <div class="summary-value total-value">₹${payment.amount.toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>

        <div class="footer">
          <p><strong>This is a computer generated document. No signature required.</strong></p>
          <p>SkillBridge Marketplace | 100% Secure Escrow Service | support@skillbridge.club</p>
          <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} SkillBridge Technologies. Registered Office: Bengaluru, India.</p>
        </div>
      </body>
      </html>
    `;

        return await PDFService.generatePDF(html);
    }
}

module.exports = new InvoiceService();
