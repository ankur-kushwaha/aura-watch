export type EdgeFileFetcher = (
  deviceId: string,
  filename: string,
) => Promise<{ contentType: string; data: Buffer | string }>;

let edgeFileFetcher: EdgeFileFetcher | null = null;

export function registerEdgeFileFetcher(fetcher: EdgeFileFetcher): void {
  edgeFileFetcher = fetcher;
}

export function fetchFileFromEdge(
  deviceId: string,
  filename: string,
): Promise<{ contentType: string; data: Buffer | string }> {
  if (!edgeFileFetcher) {
    return Promise.reject(new Error('Edge file fetcher not registered'));
  }
  return edgeFileFetcher(deviceId, filename);
}
