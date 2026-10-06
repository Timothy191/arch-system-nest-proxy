import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { log } from './logger.js';

let warnedUnconfigured = false;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Bearer-token guard for write endpoints.
 *
 * - `DISPATCH_API_KEY` set  → `Authorization: Bearer <key>` required (401 otherwise).
 * - `DISPATCH_API_KEY` unset → fail-open with a one-time warning, UNLESS
 *   `REQUIRE_API_KEY=true`, in which case requests are rejected (403).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.DISPATCH_API_KEY;

    if (!expected) {
      if (process.env.REQUIRE_API_KEY === 'true') {
        throw new ForbiddenException({
          message:
            'DISPATCH_API_KEY is not configured; dispatch is disabled because REQUIRE_API_KEY=true.',
        });
      }
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        log('warn', 'dispatch_auth_disabled', {
          hint: 'Set DISPATCH_API_KEY to require bearer auth on POST /workflows/dispatch',
        });
      }
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const header =
      typeof req.headers?.authorization === 'string'
        ? req.headers.authorization
        : '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;

    if (!token || !safeEqual(token, expected)) {
      throw new UnauthorizedException({
        message: 'Missing or invalid bearer token',
      });
    }
    return true;
  }
}
