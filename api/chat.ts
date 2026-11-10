import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/index';

const app = createApp();

/**
 * Vercel Serverless Function handler for `/api/chat`.
 * Automatically routes chat requests to the assistant adapter in production.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  // Pass directly to the configured Express application
  app(req as any, res as any);
}
