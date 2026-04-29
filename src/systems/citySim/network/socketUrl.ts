export function lanHubSocketUrl(host?: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  if (host && host.trim()) return `${proto}://${host.trim()}/lan`;
  return `${proto}://${window.location.host}/lan`;
}

