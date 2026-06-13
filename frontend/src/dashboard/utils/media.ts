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

export function buildInstallCmd(enrollmentToken?: string) {
  const tokenPart = enrollmentToken ? ` ENROLLMENT_TOKEN='${enrollmentToken}'` : '';
  return `CLOUD_URL='${HUB_HTTP}'${tokenPart} sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"`;
}
