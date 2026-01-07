const mongoose = require('mongoose');
const User = require('../modules/users/user.model');
const config = require('../config/env');
const logger = require('../config/logger');
const { ROLES } = require('../common/constants/roles');

/**
 * Seed data for development
 * This script provides a scalable way to populate the database with initial data.
 */
const seedData = async () => {
    try {
        // 1. Environment Guard
        if (config.NODE_ENV === 'production') {
            logger.error('Safety Triggered: Seeding is disabled in production to prevent data loss.');
            process.exit(1);
        }

        // 2. Connect to Database
        logger.info(`Starting seeding in [${config.NODE_ENV}] mode...`);
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(config.MONGODB_URI);
            logger.info('Connected to MongoDB.');
        }

        // 3. Clear existing data
        // We clear users to ensure the seed is predictable
        const deleteResult = await User.deleteMany({ role: { $ne: ROLES.ADMIN } });
        logger.info(`Cleared ${deleteResult.deletedCount} existing non-admin users.`);

        // 4. Seed Data Definitions
        const users = [
            {
                email: 'admin@skillbridge.com',
                password: 'AdminPassword123!',
                role: ROLES.ADMIN,
                name: 'System Admin',
                phone: '9999999999',
                dateOfBirth: new Date('1985-01-01'),
                isEmailVerified: true,
                isActive: true
            },
            {
                email: 'worker@skillbridge.com',
                password: 'WorkerPassword123!',
                role: ROLES.WORKER,
                name: 'John Professional',
                phone: '9888888888',
                dateOfBirth: new Date('1992-05-15'),
                services: ['Plumbing', 'Electrical'],
                skills: ['Copper piping', 'Circuit wiring'],
                experience: 5,
                isEmailVerified: true,
                isActive: true,
                address: {
                    city: 'Mumbai',
                    state: 'Maharashtra',
                    pincode: '400001'
                }
            },
            {
                email: 'client@skillbridge.com',
                password: 'ClientPassword123!',
                role: ROLES.USER,
                name: 'Alice Customer',
                phone: '9777777777',
                dateOfBirth: new Date('1995-10-20'),
                isEmailVerified: true,
                isActive: true,
                address: {
                    city: 'Pune',
                    state: 'Maharashtra',
                    pincode: '411001'
                }
            }
        ];

        // 5. Execute Seeding
        logger.info(`Seeding ${users.length} users...`);

        // create() ensures password hashing hooks are executed
        await User.create(users);

        logger.info('✅ Seeding completed successfully.');
        process.exit(0);
    } catch (error) {
        logger.error(`❌ Seeding failed: ${error.message}`);
        if (error.stack) logger.debug(error.stack);
        process.exit(1);
    }
};

// Handle Process Events
process.on('unhandledRejection', (err) => {
    logger.error(`Fatal Unhandled Rejection: ${err.message}`);
    process.exit(1);
});

// Run
seedData();
