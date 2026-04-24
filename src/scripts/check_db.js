const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const JobSchema = new mongoose.Schema({
    job_title: String,
    status: String,
    is_contractor_project: Boolean
}, { strict: false });

const Job = mongoose.model('Job', JobSchema);

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const jobs = await Job.find({ 
            status: { $in: ['assigned', 'eta_confirmed', 'diagnosis_mode', 'material_pending_approval', 'in_progress', 'reviewing', 'cooling_window', 'disputed'] } 
        }).select('job_title status is_contractor_project');

        console.log('\n--- JOB STATUS REPORT ---');
        console.log(`Total jobs found in active/settling statuses: ${jobs.length}`);
        
        jobs.forEach(j => {
            console.log(`[${j.status.toUpperCase()}] ${j.job_title} (Contractor: ${j.is_contractor_project || false})`);
        });

        // Check counts using the EXACT logic I put in the controller
        const activeCount = await Job.countDocuments({ status: { $in: ['assigned', 'eta_confirmed', 'diagnosis_mode', 'material_pending_approval', 'in_progress'] } });
        const settlingCount = await Job.countDocuments({ status: { $in: ['reviewing', 'cooling_window'] } });
        const disputedCount = await Job.countDocuments({ status: 'disputed' });

        console.log('\n--- SYSTEM COUNTS (As per latest logic) ---');
        console.log(`Active (Field Work Only): ${activeCount}`);
        console.log(`Settling (Review/Cooling): ${settlingCount}`);
        console.log(`Disputed: ${disputedCount}`);

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
