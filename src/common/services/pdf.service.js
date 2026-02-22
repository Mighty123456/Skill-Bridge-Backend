const puppeteer = require('puppeteer');
const logger = require('../../config/logger');

/**
 * Generate PDF from HTML
 */
exports.generatePDF = async (html, options = {}) => {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm',
      },
      ...options,
    });

    await browser.close();
    return pdfBuffer;
  } catch (error) {
    logger.error(`PDF generation error: ${error.message}`);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
};
