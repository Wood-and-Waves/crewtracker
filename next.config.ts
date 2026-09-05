import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// This machine's own LAN addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x).
//
// WHY THIS EXISTS
// ---------------
// `next dev` blocks cross-origin requests to /_next/* dev resources by
// default. Open the dev server from a phone on the wifi — http://192.168.x.x:3000
// rather than localhost — and the HMR client is refused, the dev runtime never
// finishes booting, and REACT NEVER HYDRATES. The page still renders, because
// the HTML is server-rendered, so it looks completely fine and every tap does
// nothing. That cost a long debugging session on the crew clock, where testing
// on a real phone is the whole point.
//
// Computed rather than hard-coded: the address changes whenever DHCP feels
// like it, and a stale literal here fails in exactly the same silent way.
// Only ever this machine's own addresses, and only in dev — `next build` and
// production ignore allowedDevOrigins entirely.
function lanOrigins(): string[] {
  const out: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address)
    }
  }
  return out
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanOrigins(),
};

export default nextConfig;
