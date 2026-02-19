const Redis = require('ioredis');
const logger = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisConfig = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
};

let redisConnection;
let isRedisAvailable = false;

try {
    redisConnection = new Redis(REDIS_URL, redisConfig);

    redisConnection.on('error', (err) => {
        if (err.code === 'ECONNREFUSED' && !isRedisAvailable) {
            // Only log once to avoid spamming
            logger.warn(`⚠️ Redis Connection Refused at ${err.address}:${err.port}. Background tasks and real-time scaling will be disabled until Redis is started.`);
            isRedisAvailable = false;
        } else if (err.code !== 'ECONNREFUSED') {
            logger.error('Redis Error:', err);
        }
    });

    redisConnection.on('connect', () => {
        logger.info('✅ Redis Connected');
        isRedisAvailable = true;
    });

} catch (e) {
    logger.warn('Redis initialization failed. Proceeding without Redis.');
}

module.exports = {
    redisConnection,
    isRedisAvailable: () => isRedisAvailable,
    REDIS_URL
};
