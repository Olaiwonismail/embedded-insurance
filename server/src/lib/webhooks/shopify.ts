import crypto from 'crypto';
import { Request } from 'express';

import { timingSafeEqual } from './crypto';
import { PlatformVerifier, WebhookEventData, WebhookValidationError } from './types';

export class ShopifyVerifier implements PlatformVerifier {
  readonly platform = 'shopify';

  verifySignature(req: Request, rawBody: Buffer, secret: string): boolean {
    const signatureHeader = req.get('x-shopify-hmac-sha256');
    if (!signatureHeader) {
      return false;
    }

    const computedHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    return timingSafeEqual(signatureHeader.trim(), computedHmac);
  }

  extractEvent(req: Request, rawBody: Buffer): WebhookEventData {
    const eventId = req.get('x-shopify-webhook-id');
    const type = req.get('x-shopify-topic');

    if (!eventId || eventId.trim() === '') {
      throw new WebhookValidationError('Missing X-Shopify-Webhook-Id header');
    }

    if (!type || type.trim() === '') {
      throw new WebhookValidationError('Missing X-Shopify-Topic header');
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookValidationError('Request body is not valid JSON');
    }

    return {
      eventId: eventId.trim(),
      type: type.trim(),
      payload,
    };
  }
}
