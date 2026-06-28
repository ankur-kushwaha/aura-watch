import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || "phc_xuWeW1axhPe67lrlmU9jVKYgozklO4gNYvcRsIH3nzD";
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';

export const initPostHog = () => {
  if (POSTHOG_KEY) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      capture_pageview: 'history_change',
      loaded: (ph) => {
        if (import.meta.env.DEV) {
          ph.debug();
        }
      },
    });
  } else {
    if (import.meta.env.DEV) {
      console.log('[PostHog] VITE_POSTHOG_KEY is not defined. Analytics tracking is disabled.');
    }
  }
};

export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (POSTHOG_KEY) {
    posthog.capture(eventName, properties);
  }
};

export const identifyUser = (userId: string, properties?: Record<string, any>) => {
  if (POSTHOG_KEY) {
    posthog.identify(userId, properties);
  }
};

export const resetPostHog = () => {
  if (POSTHOG_KEY) {
    posthog.reset();
  }
};
