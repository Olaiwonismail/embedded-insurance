import crypto from 'crypto';
import { Request } from 'express';

import { timingSafeEqual } from './crypto';
import { PlatformVerifier, WebhookEventData, WebhookValidationError } from './types';

const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60; // 300 seconds (5 minutes)

export class CustomVerifier implements PlatformVerifier {
  readonly platform = 'custom';

  verifySignature(req: Request, rawBody: Buffer, secret: string): boolean {
    const signatureHeader = req.get('x-insureongo-signature');
    const timestampHeader = req.get('x-insureongo-timestamp');

    if (!signatureHeader || !timestampHeader) {
      return false;
    }

    if (!/^-?\d+$/.test(timestampHeader.trim())) {
      return false;
    }

    const timestamp = parseInt(timestampHeader.trim(), 10);
    const now = Math.floor(Date.now() / 1000);

    // Must be within 5 minutes of our server clock
    if (Math.abs(now - timestamp) > MAX_TIMESTAMP_AGE_SECONDS) {
      return false;
    }

    const computedHex = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return timingSafeEqual(signatureHeader.trim().toLowerCase(), computedHex.toLowerCase());
  }

  extractEvent(_req: Request, rawBody: Buffer): WebhookEventData {
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookValidationError('Request body is not valid JSON');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new WebhookValidationError('Request body is not valid JSON');
    }

    const { eventId, type } = payload;

    if (typeof eventId !== 'string' || eventId.trim() === '') {
      throw new WebhookValidationError('Missing or invalid eventId in request body');
    }

    if (typeof type !== 'string' || type.trim() === '') {
      throw new WebhookValidationError('Missing or invalid type in request body');
    }

    return {
      eventId: eventId.trim(),
      type: type.trim(),
      payload,
    };
  }
}
