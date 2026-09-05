import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = path.resolve('storage/logs');
fs.mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'automation-hub' },
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, jobId, module: mod }) => {
          const meta = jobId ? ` [job:${jobId}]` : mod ? ` [${mod}]` : '';
          return `${timestamp} ${level}${meta}: ${message}`;
        })
      ),
    }),
  ],
});

export default logger;
