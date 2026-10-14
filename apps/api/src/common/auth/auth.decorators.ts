import { SetMetadata, createParamDecorator } from '@nestjs/common';

/** Identity derived only from a verified Keycloak access token; never from request data. */
export type AuthUser = { sub: string; username: string; email?: string; roles: string[] };
export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);
export const CurrentUser = createParamDecorator((_data, context) => context.switchToHttp().getRequest().user as AuthUser);
