export const HUB_HTTP = import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin;

export function buildInstallCmd(enrollmentToken?: string, tailscaleAuthKey?: string | null) {
  const tokenPart = enrollmentToken ? ` ENROLLMENT_TOKEN='${enrollmentToken}'` : '';
  const tailscalePart = tailscaleAuthKey ? ` TAILSCALE_AUTH_KEY='${tailscaleAuthKey}'` : '';
  return `CLOUD_URL='${HUB_HTTP}'${tokenPart}${tailscalePart} sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"`;
}
