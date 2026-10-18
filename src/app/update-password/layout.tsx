/**
 * F-18: the page is a client component, and route segment config must live in a server file.
 * `force-dynamic` here makes the route render per request, so the proxy's CSP nonce is applied.
 */
export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
