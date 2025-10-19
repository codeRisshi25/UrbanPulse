import express from 'express';
import logger from './logger.js'

const app = express();


app.listen("3001", () => {
  logger.info("Server started on port 3001");
});