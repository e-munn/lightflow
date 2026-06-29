// Returns the server's LAN IPv4 so the /live QR can point at the laptop's real
// address (the browser can't read its own LAN IP, so localhost-opened pages
// would otherwise encode "localhost" in the QR).
import { NextResponse } from 'next/server';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const ifaces = os.networkInterfaces();
  let ip = '';
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      // skip loopback, link-local (169.254.x), and non-IPv4
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) {
        ip = i.address;
        break;
      }
    }
    if (ip) break;
  }
  return NextResponse.json({ ip });
}
