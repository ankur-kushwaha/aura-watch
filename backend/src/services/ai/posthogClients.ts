import OpenAINative from 'openai';
import { OpenAI as PostHogOpenAI } from '@posthog/ai/openai';
import { GoogleGenAI as NativeGoogleGenAI } from '@google/genai';
import { GoogleGenAI as PostHogGoogleGenAI } from '@posthog/ai/gemini';
import { getPostHogClient } from '../posthog';

type OpenAIClientOptions = ConstructorParameters<typeof OpenAINative>[0];
type GeminiModels = NativeGoogleGenAI['models'];

export function createMonitoredOpenAIClient(options: OpenAIClientOptions) {
  const posthog = getPostHogClient();
  if (posthog) {
    const apiKey = typeof options?.apiKey === 'string' ? options.apiKey : '';
    return new PostHogOpenAI({
      apiKey,
      posthog,
      baseURL: options?.baseURL ?? undefined,
      defaultHeaders: options?.defaultHeaders,
      organization: options?.organization ?? undefined,
      project: options?.project ?? undefined,
    });
  }
  return new OpenAINative(options);
}

export function createGeminiClients(apiKey: string): {
  files: NativeGoogleGenAI;
  models: GeminiModels;
} {
  const native = new NativeGoogleGenAI({ apiKey });
  const posthog = getPostHogClient();
  if (!posthog) {
    return { files: native, models: native.models };
  }

  const monitored = new PostHogGoogleGenAI({ apiKey, posthog });
  return { files: native, models: monitored.models as unknown as GeminiModels };
}

/** Redact large inline image/video payloads from PostHog AI events. */
export const POSTHOG_VISION_PRIVACY = { posthogPrivacyMode: true as const };
