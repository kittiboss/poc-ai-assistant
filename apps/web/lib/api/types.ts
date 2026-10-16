import type { components } from './schema';

// Generated from the API's OpenAPI document (npm run api:types). A few nullable fields in that
// document have no declared type and come out as Record<string, never>; they are treated as unknown.
type Untyped = Record<string, never>;
type Loosen<T> = T extends Untyped
  ? unknown
  : T extends (infer Item)[]
    ? Loosen<Item>[]
    : T extends object
      ? { [Key in keyof T]: Loosen<T[Key]> }
      : T;
type Schema<Name extends keyof components['schemas']> = Loosen<components['schemas'][Name]>;

export type Model = Schema<'ModelView'>;
export type ConversationSummary = Schema<'ConversationSummary'>;
export type ConversationDetail = Schema<'ConversationDetail'>;
export type Message = Schema<'MessageView'>;
export type MyUsage = Schema<'MyUsageResponse'>;
export type AdminSummary = Schema<'AdminSummary'>;
export type AdminModel = Schema<'AdminModelView'>;
export type PricingConfiguration = Schema<'PricingConfigurationView'>;
export type PricingVersion = Schema<'PricingVersionView'>;
export type PricingStrategy = PricingVersion['strategy'];
export type AdminUser = Schema<'AdminUserView'>;
export type AuditLog = Schema<'AuditLogView'>;
export type PriceResult = Schema<'PriceResultView'>;
export type UpdatePricing = components['schemas']['UpdatePricingDto'];
export type UpdateModel = components['schemas']['UpdateModelDto'];
export type SendMessage = components['schemas']['SendMessageDto'];
