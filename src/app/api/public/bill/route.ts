import { NextRequest } from 'next/server';
import { handleServiceRequest } from '@/lib/service-request';

/**
 * POST /api/public/bill — «طلب فاتورة» from the table menu.
 * Stored in `service_requests`; staff are notified by push + Telegram.
 * All validation, rate limiting and tenant checks live in the shared handler.
 */
export async function POST(request: NextRequest) {
  return handleServiceRequest(request, 'bill');
}