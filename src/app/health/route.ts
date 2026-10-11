// Stable, platform-friendly readiness endpoint. The canonical implementation
// and its dependency checks remain in /api/health so both paths agree.
export { GET } from '../api/health/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
