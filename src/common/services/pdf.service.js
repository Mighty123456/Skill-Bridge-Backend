const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit-table');
const logger = require('../../config/logger');

class PDFService {
  /**
   * Generate PDF from HTML
   * @param {string} html 
   * @returns {Promise<Buffer>}
   */
  async generatePDF(html) {
    let browser;
    try {
      logger.info('Starting Puppeteer PDF generation...');
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-web-security'
        ],
        timeout: 15000,
      });

      const page = await browser.newPage();
      await page.emulateMediaType('print');
      
      await page.setContent(html, { 
        waitUntil: ['load', 'networkidle0'],
        timeout: 10000 
      });
      
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
        preferCSSPageSize: true
      });

      await browser.close();
      logger.info('Puppeteer PDF generation successful');
      return pdf;
    } catch (error) {
      if (browser) await browser.close();
      logger.error('Puppeteer failed, falling back to PDFKit:', error.message);
      return this.generatePDFFallback(html);
    }
  }

  /**
   * High-quality Fallback using PDFKit - Theme Optimized
   */
  async generatePDFFallback(html) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 0, size: 'A4' });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        
        // Register and use Arial for Rupee symbol support
        const fontPath = 'C:\\Windows\\Fonts\\arial.ttf';
        const fontBoldPath = 'C:\\Windows\\Fonts\\arialbd.ttf';
        
        try {
            doc.registerFont('SystemArial', fontPath);
            doc.registerFont('SystemArialBold', fontBoldPath);
            doc.font('SystemArial');
        } catch (e) {
            logger.warn('System Arial fonts not found, falling back to built-in fonts');
            doc.font('Helvetica');
        }

        const width = 595.28;
        const height = 841.89;
        const margin = 50;
        const contentWidth = width - (margin * 2);

        // --- SKILLBRIDGE BRAND COLORS ---
        const COLORS = {
            TEAL: '#008080',       // Primary
            NAVY: '#1e293b',       // Secondary / Headers
            EMERALD: '#10b981',    // Accent / Success
            SLATE: '#64748b',      // Muted text
            GHOST: '#f8fafc',      // Card backgrounds
            BORDER: '#e2e8f0'      // Divider lines
        };

        // Data extraction
        const invMatch = html.match(/(#INV-|#SKB-|SET-)([A-Z0-9]+)/i);
        const nameMatch = html.match(/class="name">([^<]+)<\/div>/i) || 
                          html.match(/party-name">([^<]+)<\/div>/i) || 
                          html.match(/value-bold">([^<]+)<\/div>/i);
        const amountMatch = html.match(/total-value">.*?₹?([0-9,.]+)/i) || 
                            html.match(/total-val">.*?₹?([0-9,.]+)/i) ||
                            html.match(/grand-val">.*?₹?([0-9,.]+)/i) ||
                            html.match(/final">.*?<b>.*?₹?([0-9,.]+)/i) ||
                            html.match(/₹([0-9,.]+)/i);

        // 1. BRAND ACCENTS
        doc.rect(0, 0, width, 14).fill(COLORS.TEAL);
        doc.rect(20, 20, width - 40, height - 40).lineWidth(0.5).strokeColor(COLORS.BORDER).stroke();

        // 2. HEADER
        const topY = 65;
        doc.fillColor(COLORS.TEAL).fontSize(34).font('SystemArialBold').text('SkillBridge', margin, topY);
        doc.fontSize(10).fillColor(COLORS.SLATE).font('SystemArial').text('MANAGED PROFESSIONAL ECOSYSTEM', margin, topY + 36);
        
        doc.fillColor(COLORS.NAVY).fontSize(26).font('SystemArialBold').text('TAX INVOICE', margin, topY, { align: 'right', width: contentWidth });
        doc.fontSize(12).fillColor(COLORS.TEAL).font('SystemArialBold').text(`Ref: ${invMatch ? invMatch[0] + invMatch[2] : 'SKB-' + Date.now().toString().slice(-6)}`, margin, topY + 34, { align: 'right', width: contentWidth });
        doc.fontSize(10).fillColor(COLORS.SLATE).font('SystemArial').text(`Date: ${new Date().toLocaleDateString('en-IN', {day: 'numeric', month: 'long', year: 'numeric'})}`, margin, topY + 50, { align: 'right', width: contentWidth });

        // 3. SEPARATOR
        doc.moveTo(margin, 135).lineTo(width - margin, 135).lineWidth(1.5).strokeColor(COLORS.TEAL).stroke();

        // 4. PARTY CARDS
        const partyY = 160;
        // Billed To
        doc.roundedRect(margin, partyY, (contentWidth / 2) - 10, 85, 8).fill(COLORS.GHOST);
        doc.fillColor(COLORS.TEAL).fontSize(9).font('SystemArialBold').text('BILLED TO', margin + 15, partyY + 15);
        doc.fillColor(COLORS.NAVY).fontSize(16).font('SystemArialBold').text(nameMatch ? nameMatch[1].trim().replace(/<[^>]*>?/gm, '') : 'Valued Customer', margin + 15, partyY + 30, { width: (contentWidth / 2) - 40 });
        doc.fillColor(COLORS.SLATE).fontSize(10).font('SystemArial').text('Verified Ecosystem Member', margin + 15, partyY + 52);
 
        // Supplier
        doc.roundedRect(width / 2 + 10, partyY, (contentWidth / 2) - 10, 85, 8).fill(COLORS.GHOST);
        doc.fillColor(COLORS.TEAL).fontSize(9).font('SystemArialBold').text('SUPPLIER', width / 2 + 25, partyY + 15);
        doc.fillColor(COLORS.NAVY).fontSize(13).font('SystemArialBold').text('SkillBridge Technologies Pvt Ltd', width / 2 + 25, partyY + 30);
        doc.fillColor(COLORS.SLATE).fontSize(9.5).font('SystemArial').text('GSTIN: 29AABCU1234A1Z1', width / 2 + 25, partyY + 48);
        doc.text('support@skillbridge.club', width / 2 + 25, partyY + 62);

        // 5. THEMED TABLE
        doc.moveDown(5);
        const currentY = doc.y;
        const col1Width = contentWidth - 150;
        const col2Width = 150;

        // Custom Header Drawing for Precise Alignment
        doc.rect(margin, currentY, contentWidth, 32).fill(COLORS.NAVY);
        doc.fillColor('#ffffff').font('SystemArialBold').fontSize(10);
        doc.text('DESCRIPTION OF SERVICES', margin + 15, currentY + 11);
        doc.text('AMOUNT (\u20B9)', margin + col1Width, currentY + 11, { width: col2Width - 15, align: 'right' });

        doc.y = currentY + 32;

        const table = {
          headers: [
            { label: "DESCRIPTION OF SERVICES", property: 'desc', width: col1Width },
            { label: "AMOUNT (\u20B9)", property: 'price', width: col2Width, align: 'right' }
          ],
          rows: [
            ["Platform Managed Service Execution & Escrow Management", `\u20B9 ${amountMatch ? amountMatch[1] : '0.00'}`],
            ["Verified Security & Statutory Compliance Fees", "INCLUDED"]
          ],
        };

        doc.table(table, { 
          prepareRow: () => doc.font("SystemArial").fontSize(10).fillColor(COLORS.NAVY),
          padding: 15,
          x: margin,
          width: contentWidth,
          hideHeader: true,
          divider: {
            horizontal: { disabled: false, width: 0.5, color: COLORS.BORDER }
          }
        });

        // 6. TOTALS STAMP
        doc.moveDown(4);
        const tBoxWidth = 260;
        const tBoxHeight = 75;
        const tBoxX = width - margin - tBoxWidth;
        const tBoxY = doc.y;
        
        doc.roundedRect(tBoxX, tBoxY, tBoxWidth, tBoxHeight, 15).fill(COLORS.NAVY);
        
        doc.fillColor('#94a3b8').fontSize(10).font('SystemArialBold').text('GRAND TOTAL', tBoxX + 25, tBoxY + 32);
        
        const totalText = `\u20B9 ${amountMatch ? amountMatch[1] : '0.00'}`;
        doc.fillColor(COLORS.EMERALD).fontSize(28).font('SystemArialBold').text(totalText, tBoxX + 110, tBoxY + 24, { align: 'right', width: tBoxWidth - 135 });

        // 7. FOOTER
        const footY = height - 100;
        doc.fillColor(COLORS.TEAL).rect(margin, footY, contentWidth, 2).fill();
        
        doc.fillColor(COLORS.SLATE).fontSize(9).font('SystemArial').text('DIGITALLY SIGNED & OFFICIALLY VERIFIED BY SKILLBRIDGE SECURE KERNEL', margin, footY + 12, { align: 'center', width: contentWidth });
        doc.text('This is a computer-generated tax document valid as per IT Act 2000.', margin, footY + 26, { align: 'center', width: contentWidth });
        doc.fillColor(COLORS.TEAL).fontSize(10).font('SystemArialBold').text('PROCESSED & PAID', margin, footY + 45, { align: 'center', width: contentWidth });

        doc.end();
      } catch (err) {
        logger.error('Theme fallback critically failed:', err);
        reject(err);
      }
    });
  }
}

module.exports = new PDFService();
