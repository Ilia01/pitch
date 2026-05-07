import { pino } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const isTty = process.stdout.isTTY === true;

export const log = pino(
  isTty
    ? {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level },
);
