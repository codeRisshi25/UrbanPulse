import pino from 'pino';

const transport = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: { destination: '../logs/dev.log' },
    },
    {
      target: 'pino-pretty',
    },
  ],
});

const logger = pino(transport);

export default logger;
