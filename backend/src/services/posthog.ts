import { PostHog } from 'posthog-node';

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';

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

/**
 * Capture an error to PostHog error tracking. Used to surface failures that are
 * otherwise swallowed by a catch (e.g. background AI summary generation), so they
 * stop being invisible in the data.
 */
export const trackException = (
  error: unknown,
  distinctId: string,
  properties?: Record<string, any>,
) => {
  if (posthogClient) {
    const err = error instanceof Error ? error : new Error(String(error));
    posthogClient.captureException(err, distinctId, properties);
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

export const getPostHogClient = (): PostHog | null => posthogClient;
