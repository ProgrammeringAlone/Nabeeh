import { fetch, EnvHttpProxyAgent } from "undici";
// Respect the platform's HTTPS proxy and existing NODE_EXTRA_CA_CERTS trust.
// No TLS verification options are overridden. NO_PROXY keeps local requests local.
const dispatcher = new EnvHttpProxyAgent();
export async function providerFetch(
  url: string,
  init: Parameters<typeof fetch>[1],
) {
  return fetch(url, { ...init, dispatcher });
}
