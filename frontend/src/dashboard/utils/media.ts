import { API_BASE, getToken } from '../../api';
import { buildInstallCmd, HUB_HTTP } from '../../utils/install';

export { buildInstallCmd, HUB_HTTP };

export function mediaUrl(path: string) {
  const token = getToken();
  const qs = token ? `?access_token=${encodeURIComponent(token)}` : '';
  return `${API_BASE}${path}${qs}`;
}

export function identityCoverUrl(identityId: string) {
  const token = getToken();
  const qs = token ? `?access_token=${encodeURIComponent(token)}` : '';
  return `${API_BASE}/reid/identities/${identityId}/cover${qs}`;
}

