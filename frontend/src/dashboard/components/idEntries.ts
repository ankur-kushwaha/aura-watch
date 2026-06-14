export type IdEntry = { label: string; value: string };

export function filterIdEntries(ids: IdEntry[]) {
  return ids.filter((id) => id.value && id.value !== '—');
}

export async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
}

export function buildTimelineIdEntries({
  detectionId,
  clipId,
}: {
  detectionId?: string | null;
  clipId?: string | null;
}): IdEntry[] {
  return [
    ...(detectionId ? [{ label: 'detection', value: detectionId }] : []),
    ...(clipId ? [{ label: 'clip', value: clipId }] : []),
  ];
}
