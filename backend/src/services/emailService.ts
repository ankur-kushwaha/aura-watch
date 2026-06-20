import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

let resendClient: Resend | null = null;

if (apiKey && apiKey.trim() !== '') {
  resendClient = new Resend(apiKey.trim());
  console.log('[EmailService] Resend client initialized.');
} else {
  console.warn('[EmailService] RESEND_API_KEY is not defined. Falling back to mock email logging.');
}

interface SendEmailParams {
  to: string[];
  subject: string;
  body: string;
}

export async function sendAlertEmail({ to, subject, body }: SendEmailParams): Promise<void> {
  if (to.length === 0) return;

  // Print mock email trace in console for local debugging
  console.log(`\n======================= [EMAIL ROUTING] =======================`);
  console.log(`To: ${to.join(', ')}`);
  console.log(`From: ${fromEmail}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body:\n${body}`);
  console.log(`===============================================================\n`);

  if (!resendClient) {
    console.log('[EmailService] Mock email logged. (No Resend API Key configured)');
    return;
  }

  try {
    const { data, error } = await resendClient.emails.send({
      from: fromEmail,
      to,
      subject,
      text: body,
    });

    if (error) {
      console.error('[EmailService] Resend API error:', error);
      throw new Error(`Resend API error: ${JSON.stringify(error)}`);
    }

    console.log(`[EmailService] Email sent successfully via Resend! ID: ${data?.id}`);
  } catch (err: any) {
    console.error('[EmailService] Failed to send email via Resend:', err.message);
  }
}
