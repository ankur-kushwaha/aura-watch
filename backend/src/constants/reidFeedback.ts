import { ReidFeedbackType } from '@prisma/client';

export { ReidFeedbackType };

export function isSameFeedback(type: ReidFeedbackType): boolean {
  return type === ReidFeedbackType.same;
}

export function isDifferentFeedback(type: ReidFeedbackType): boolean {
  return type === ReidFeedbackType.different;
}
