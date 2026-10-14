import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AuthUser = { sub: string; username: string; email?: string; roles: string[] };
export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);
export const CurrentUser = createParamDecorator((_data, context) => context.switchToHttp().getRequest().user as AuthUser);

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly reflector: Reflector;
  private readonly jwks;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(reflector: Reflector) {
    this.reflector = reflector;
    const publicBase = process.env.KEYCLOAK_URL || 'http://localhost:8080';
    const internalBase = process.env.KEYCLOAK_INTERNAL_URL || publicBase;
    const realm = process.env.KEYCLOAK_REALM || 'enterprise-ai';
    this.issuer = `${publicBase}/realms/${realm}`;
    this.audience = process.env.OIDC_AUDIENCE || 'enterprise-ai-api';
    this.jwks = createRemoteJWKSet(new URL(`${internalBase}/realms/${realm}/protocol/openid-connect/certs`));
  }

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const token = String(request.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer token required');
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer, audience: this.audience });
      const roles: string[] = ((payload.realm_access as { roles?: string[] } | undefined)?.roles || []).filter((role) => role === 'ADMIN' || role === 'USER');
      request.user = { sub: payload.sub!, username: String(payload.preferred_username || payload.sub), email: payload.email ? String(payload.email) : undefined, roles } satisfies AuthUser;
      const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]) || [];
      if (required.length && !required.some((role) => roles.includes(role))) throw new ForbiddenException('Insufficient role');
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
