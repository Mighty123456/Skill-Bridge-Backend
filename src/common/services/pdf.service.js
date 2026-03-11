const puppeteer = require('puppeteer');
const logger = require('../../config/logger');

/**
 * Generate PDF from HTML
 */
exports.generatePDF = async (html, options = {}) => {
  let browser = null;
  try {
    logger.info('Attempting PDF generation via Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      ...options,
    });

    await browser.close();
    return pdfBuffer;
  } catch (error) {
    logger.warn(`Puppeteer PDF failed: ${error.message}. Switching to PDFKit fallback...`);
    if (browser) await browser.close();
    
    return await this.generatePDFFallback(html);
  }
};

/**
 * Fallback PDF generator using PDFKit (no Chrome required)
 * Note: This produces a simpler document but is extremely reliable.
 */
exports.generatePDFFallback = async (html) => {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Extract basic info from HTML using regex (since we don't have a DOM)
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const logoMatch = html.match(/<div class="logo">([^<]+)<\/div>/i);
      const invMatch = html.match(/INV-([A-Z0-9]+)/i);
      const amountMatch = html.match(/₹([0-9,.]+)/i);

      // Simple header
      doc.fillColor('#008080').fontSize(25).text(logoMatch ? logoMatch[1] : 'SkillBridge', { align: 'left' });
      doc.moveDown();
      
      doc.fillColor('#444444').fontSize(20).text(titleMatch ? titleMatch[1] : 'TAX INVOICE', { align: 'right' });
      doc.fontSize(12).text(`Invoice: ${invMatch ? invMatch[1] : 'SKB-' + Date.now().toString().slice(-6)}`, { align: 'right' });
      doc.moveDown();
      
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      doc.fillColor('#1e293b').fontSize(14).text('Receipt Summary', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12).text('This is a simplified fallback invoice generated because the primary high-fidelity service is currently unavailable.');
      doc.moveDown();
      
      if (amountMatch) {
         doc.fontSize(16).fillColor('#008080').text(`Total Amount: ₹${amountMatch[1]}`, { align: 'right', weight: 'bold' });
      }

      doc.moveDown(4);
      doc.fillColor('#94a3b8').fontSize(10).text('SkillBridge Marketplace | 100% Secure Escrow Service | support@skillbridge.club', { align: 'center' });
      doc.text('© ' + new Date().getFullYear() + ' SkillBridge Technologies.', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
