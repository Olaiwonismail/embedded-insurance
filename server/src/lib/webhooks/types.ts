import { Request } from 'express';

export interface WebhookEventData {
  eventId: string;
  type: string;
  payload: any;
}

export interface PlatformVerifier {
  readonly platform: string;
  verifySignature(req: Request, rawBody: Buffer, secret: string): boolean;
  extractEvent(req: Request, rawBody: Buffer): WebhookEventData;
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}
