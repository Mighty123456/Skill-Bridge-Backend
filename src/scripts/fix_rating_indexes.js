const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function fixIndexes() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const collection = db.collection('ratings');

        console.log('\n--- CURRENT INDEXES ---');
        const indexes = await collection.indexes();
        console.log(JSON.stringify(indexes, null, 2));

        // Find the unique index on 'job'
        const jobUniqueIndex = indexes.find(idx => idx.key.job === 1 && idx.unique === true && Object.keys(idx.key).length === 1);

        if (jobUniqueIndex) {
            console.log(`\nDropping unique index: ${jobUniqueIndex.name}`);
            await collection.dropIndex(jobUniqueIndex.name);
            console.log('Index dropped successfully.');
        } else {
            console.log('\nNo single-field unique index on "job" found.');
        }

        // Check if the new composite index exists
        const compositeIndex = indexes.find(idx => idx.key.job === 1 && idx.key.worker === 1 && idx.unique === true);
        if (compositeIndex) {
            console.log('Composite unique index { job, worker } already exists.');
        } else {
            console.log('Creating composite unique index { job, worker }...');
            await collection.createIndex({ job: 1, worker: 1 }, { unique: true });
            console.log('Composite index created.');
        }

        console.log('\n--- UPDATED INDEXES ---');
        const newIndexes = await collection.indexes();
        console.log(JSON.stringify(newIndexes, null, 2));

        await mongoose.disconnect();
        console.log('\nDone.');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

fixIndexes();
