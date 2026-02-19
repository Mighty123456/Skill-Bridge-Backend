const mongoose = require('mongoose');
const { HelpCategory, KnowledgeBaseArticle } = require('../modules/help-center/help-center.model');
const config = require('../config/env');
const logger = require('../config/logger');

const seedHelpCenter = async () => {
    try {
        if (config.NODE_ENV === 'production') {
            logger.error('Safety Triggered: Seeding is disabled in production.');
            process.exit(1);
        }

        logger.info('Connecting to MongoDB for Help Center seeding...');
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(config.MONGODB_URI);
        }

        // 1. Clear existing Help Center data
        await HelpCategory.deleteMany({});
        await KnowledgeBaseArticle.deleteMany({});
        logger.info('Cleared existing Help Center categories and articles.');

        // 2. Create Knowledge Base Articles
        const articles = [
            // General/FAQ
            {
                title: 'How do I book a service?',
                content: 'To book a service, go to the Home screen, select the category of service you need, and fill in the job details. You will then receive quotations from verified professionals nearby.',
                category: 'faq',
                role: 'all',
                isFeatured: true,
                tags: ['booking', 'getting started']
            },
            {
                title: 'Is SkillBridge secure?',
                content: 'Yes, SkillBridge uses enterprise-level encryption and secure payment gateways like Stripe. Your money is held in escrow until the job is completed to your satisfaction.',
                category: 'policy',
                role: 'all',
                isFeatured: true,
                tags: ['security', 'trust', 'payments']
            },

            // Tenant Specific
            {
                title: 'Understanding Digital Signatures',
                content: 'After a worker completes a job, they will request a digital signature. This serves as your confirmation that the work has been finished successfully. Only sign after inspecting the work.',
                category: 'guide',
                role: 'tenant',
                isFeatured: true,
                jobStatus: ['reviewing'],
                tags: ['completion', 'signature']
            },
            {
                title: 'How do I add funds to my wallet?',
                content: 'Navigate to Profile > Wallet & Payments. Click on "Add Funds" and enter the amount. You can pay using Credit/Debit cards, UPI, or Net Banking via Stripe.',
                category: 'tutorial',
                role: 'tenant',
                isFeatured: false,
                tags: ['wallet', 'topup', 'payments']
            },

            // Worker Specific
            {
                title: 'How to increase your reliability score?',
                content: 'Punctuality is key! Arriving on time or early for jobs gives you bonus points. Completing jobs without disputes and responding quickly to quotations also improves your score.',
                category: 'guide',
                role: 'worker',
                isFeatured: true,
                tags: ['reliability', 'score', 'success']
            },
            {
                title: 'Withdrawing your earnings',
                content: 'Earnings are transferred to your pending balance after job completion. After a 72-hour cooling period, funds move to your withdrawable balance. You can then request a transfer to your bank account.',
                category: 'guide',
                role: 'worker',
                isFeatured: true,
                tags: ['payout', 'withdrawal', 'money']
            },
            {
                title: 'Identity Verification Process',
                content: 'To be a "Verified Professional", you must upload clear photos of your Govt ID (Aadhar/PAN) and provide a professional selfie. Our team reviews these within 24-48 hours.',
                category: 'tutorial',
                role: 'worker',
                isFeatured: false,
                tags: ['verification', 'kyc', 'profile']
            },

            // Safety & Emergency
            {
                title: 'Safety Guidelines for In-Person Work',
                content: 'Always share your live job tracking with a family member. Ensure the workspace is well-lit and safe. If you feel uncomfortable at any point, use the Emergency Support button in the app.',
                category: 'policy',
                role: 'all',
                isFeatured: true,
                tags: ['safety', 'protection', 'emergency']
            }
        ];

        const createdArticles = await KnowledgeBaseArticle.insertMany(articles);
        logger.info(`Inserted ${createdArticles.length} KB articles.`);

        // 3. Create Help Categories and Link Articles
        const categories = [
            {
                name: 'Payments & Refunds',
                icon: 'payment',
                description: 'Issues with billing, wallet, or payment processing',
                role: 'all',
                order: 1,
                articleIds: createdArticles.filter(a => a.tags.includes('payments') || a.tags.includes('wallet')).map(a => a._id)
            },
            {
                name: 'Account & Profile',
                icon: 'verification',
                description: 'Verification, login issues, and profile management',
                role: 'all',
                order: 2,
                articleIds: createdArticles.filter(a => a.tags.includes('verification') || a.tags.includes('profile')).map(a => a._id)
            },
            {
                name: 'Job Execution',
                icon: 'worker',
                description: 'How to use the job flow, signatures, and reporting work',
                role: 'all',
                order: 3,
                articleIds: createdArticles.filter(a => a.tags.includes('booking') || a.tags.includes('completion')).map(a => a._id)
            },
            {
                name: 'Safety & Trust',
                icon: 'safety',
                description: 'Safety guidelines, security protocols, and platform trust',
                role: 'all',
                order: 4,
                articleIds: createdArticles.filter(a => a.tags.includes('safety') || a.tags.includes('security')).map(a => a._id)
            },
            {
                name: 'Earnings & Payouts',
                icon: 'earnings',
                description: 'For workers: Understanding how you get paid',
                role: 'worker',
                order: 5,
                articleIds: createdArticles.filter(a => a.tags.includes('payout') || a.tags.includes('withdrawal')).map(a => a._id)
            }
        ];

        await HelpCategory.insertMany(categories);
        logger.info(`Inserted ${categories.length} help categories.`);

        logger.info('✅ Help Center seeding completed successfully.');
        process.exit(0);
    } catch (error) {
        logger.error(`❌ Help Center seeding failed: ${error.message}`);
        process.exit(1);
    }
};

seedHelpCenter();
