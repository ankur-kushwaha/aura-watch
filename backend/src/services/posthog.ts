import { PostHog } from 'posthog-node';

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

let posthogClient: PostHog | null = null;

if (POSTHOG_KEY) {
  posthogClient = new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
  });
} else {
  if (process.env.NODE_ENV === 'development') {
    console.log('[PostHog] POSTHOG_KEY is not defined. Backend tracking is disabled.');
  }
}

export const trackEvent = (distinctId: string, eventName: string, properties?: Record<string, any>) => {
  if (posthogClient) {
    posthogClient.capture({
      distinctId,
      event: eventName,
      properties,
    });
  }
};

export const identifyUser = (distinctId: string, properties?: Record<string, any>) => {
  if (posthogClient) {
    posthogClient.identify({
      distinctId,
      properties,
    });
  }
};

export const shutdownPostHog = async () => {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
};
