import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface.js';

/**
 * Fastify request after the auth pipeline has run. Passport's JWT strategy
 * attaches the validated {@link JwtPayload} as `request.user`; it is optional
 * here because public routes (and the moment before the guards run) have no
 * authenticated principal.
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user?: JwtPayload;
}
