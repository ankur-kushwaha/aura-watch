import { WebSocket } from 'ws';

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

const pendingRequests = new Map<string, PendingRequest>();
let nextRequestId = 0;

let getActiveDevice: (deviceId: string) => WebSocket | undefined = () => undefined;

export function initDeviceCommands(getDevice: (deviceId: string) => WebSocket | undefined) {
  getActiveDevice = getDevice;
}

export function resolveDeviceCommandResponse(
  requestId: string,
  success: boolean,
  payload: Record<string, unknown>
) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);

  if (success) {
    pending.resolve(payload);
  } else {
    pending.reject(new Error(String(payload.error || payload.message || 'Command failed')));
  }
}

export function sendDeviceCommand(
  deviceId: string,
  command: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<Record<string, unknown>> {
  const deviceSocket = getActiveDevice(deviceId);
  if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Device is offline'));
  }

  const requestId = `cmd_${Date.now()}_${nextRequestId++}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Device did not respond in time'));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    deviceSocket.send(JSON.stringify({
      type: 'device_command',
      requestId,
      command,
      ...params,
    }));
  });
}
