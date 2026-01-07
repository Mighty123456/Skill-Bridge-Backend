const mongoose = require('mongoose');
const User = require('../modules/users/user.model');
const Admin = require('../modules/admin/admin.model');
const Worker = require('../modules/workers/worker.model');
const Contractor = require('../modules/contractors/contractor.model');
const config = require('../config/env');
const logger = require('../config/logger');
const { ROLES } = require('../common/constants/roles');

/**
 * Seed data for development
 * This script seeds ONLY the Admin user, creating entries in both
 * the User collection (for auth) and Admin collection (for profile).
 * It wipes all other data (Workers, Contractors, Users).
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
        // We clear all related collections to ensure a clean slate
        const deleteAdmins = await Admin.deleteMany({});
        const deleteWorkers = await Worker.deleteMany({});
        const deleteContractors = await Contractor.deleteMany({});
        const deleteUsers = await User.deleteMany({});

        logger.info(`Cleared Data:`);
        logger.info(`- Users: ${deleteUsers.deletedCount}`);
        logger.info(`- Admins: ${deleteAdmins.deletedCount}`);
        logger.info(`- Workers: ${deleteWorkers.deletedCount}`);
        logger.info(`- Contractors: ${deleteContractors.deletedCount}`);

        // 4. Create Admin User (Standalone Admin Collection)
        const adminPayload = {
            email: '22it433@bvmengineering.ac.in',
            password: 'admin@123',
            name: 'System Admin',
            role: ROLES.ADMIN,
            roleTitle: 'Super Administrator',
            department: 'IT Administration',
            permissions: ['ALL_ACCESS'],
            isActive: true
        };

        logger.info('Creating Admin User...');
        await Admin.create(adminPayload);

        logger.info('✅ Admin seeding completed successfully.');
        logger.info(`Admin Credentials: ${adminPayload.email} / ${adminPayload.password}`);

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
