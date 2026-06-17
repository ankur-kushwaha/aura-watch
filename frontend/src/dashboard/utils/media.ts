import { API_BASE, getToken } from '../../api';
import { HUB_HTTP } from '../constants';

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

export function buildInstallCmd(enrollmentToken?: string, tailscaleAuthKey?: string | null) {
  const tokenPart = enrollmentToken ? ` ENROLLMENT_TOKEN='${enrollmentToken}'` : '';
  const tailscalePart = tailscaleAuthKey ? ` TAILSCALE_AUTH_KEY='${tailscaleAuthKey}'` : '';
  return `CLOUD_URL='${HUB_HTTP}'${tokenPart}${tailscalePart} sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"`;
}
