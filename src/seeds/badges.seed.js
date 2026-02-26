const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Badge = require('../modules/workers/badge.model');

// Load env vars
dotenv.config();

const dbUrl = process.env.MONGODB_URI;

// Define the official SkillBridge Badge Tier System
const badges = [
    {
        name: 'Rising Star',
        slug: 'rising-star',
        description: 'Awarded to workers who have completed at least 5 jobs with a rating of 4.5 or higher.',
        color: '#ffc107', // Amber/Gold
        icon: 'star',     // FontAwesome or Material Icon name
        isActive: true,
    },
    {
        name: 'Proven Pro',
        slug: 'proven-pro',
        description: 'Awarded to workers who have completed at least 25 jobs with a highly positive rating of 4.6 or higher.',
        color: '#0ea5e9', // Sky Blue
        icon: 'shield-check',
        isActive: true,
    },
    {
        name: 'Elite Pro',
        slug: 'elite-pro',
        description: 'Awarded to top-tier professionals with over 100 completed jobs and an impeccable 4.8+ rating.',
        color: '#8b5cf6', // Violet/Purple (Premium)
        icon: 'crown',
        isActive: true,
    },
    {
        name: 'Swift Savior',
        slug: 'swift-savior',
        description: 'Awarded for exceptional punctuality on emergency jobs (5+ emergency jobs, 4.5+ punctuality).',
        color: '#ef4444', // Red/Pulse
        icon: 'lightning-bolt',
        isActive: true,
    },
    {
        name: 'Trusted Partner',
        slug: 'trusted-partner',
        description: 'Awarded to highly reliable workers with a reliability score over 90, zero cancellations, and zero disputes.',
        color: '#10b981', // Emerald/Green
        icon: 'handshake',
        isActive: true,
    }
];

const seedBadges = async () => {
    try {
        if (!dbUrl) {
            console.error('MONGODB_URI is not defined in the environment variables.');
            process.exit(1);
        }

        await mongoose.connect(dbUrl);
        console.log('MongoDB Connected for Seeding Badges...');

        // Optionally delete existing badges, except manual ones like KYC
        const manualSlugs = ['kyc-verified', 'background-checked'];
        await Badge.deleteMany({ slug: { $nin: manualSlugs } });
        console.log('Cleared old performance badges.');

        await Badge.insertMany(badges);
        console.log('✅ Performance Badges Seeded Successfully!');

        process.exit();
    } catch (error) {
        console.error(`Error Seeding Badges: ${error.message}`);
        process.exit(1);
    }
};

seedBadges();
