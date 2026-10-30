// No provider is chosen yet, so sending sits behind this one interface.
// Swap in a real implementation here and nothing else has to change.

export interface Email {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  send(email: Email): Promise<void>;
}

export interface FakeEmailSender extends EmailSender {
  sent: Email[];
}

// Keeps every email in memory so tests can read them back.
export function createFakeEmailSender(): FakeEmailSender {
  const sent: Email[] = [];
  return {
    sent,
    async send(email: Email): Promise<void> {
      sent.push(email);
    },
  };
}

// Used until a provider is picked. Logs the address only, never the body: bills name
// the store's policies.
export const logOnlyEmailSender: EmailSender = {
  async send(email: Email): Promise<void> {
    console.log(`Email not sent (no provider configured): "${email.subject}" to ${email.to}`);
  },
};
