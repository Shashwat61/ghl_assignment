import winston from 'winston';

const { combine, timestamp, colorize, printf, errors } = winston.format;

const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${stack || message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'HH:mm:ss' }),
    colorize(),
    devFormat,
  ),
  transports: [new winston.transports.Console()],
});
