import type { components } from './schema';

// Generated from the API's OpenAPI document (npm run api:types).
type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];

export type Model = Schema<'ModelView'>;
export type ConversationSummary = Schema<'ConversationSummary'>;
export type ConversationDetail = Schema<'ConversationDetail'>;
export type Conversation = Schema<'ConversationView'>;
export type ConversationChange = Schema<'UpdateConversationDto'>;
export type Message = Schema<'MessageView'>;
export type Citation = Message['citations'][number];
export type MyUsage = Schema<'MyUsageResponse'>;
export type LiveUsage = Schema<'LiveUsageResponse'>;
export type ModelUsage = Schema<'ModelUsageResponse'>;
export type AdminSummary = Schema<'AdminSummary'>;
export type CreditStatus = Schema<'CreditStatusView'>;
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
export type Attachment = Schema<'AttachmentView'>;
export type AttachmentRef = Schema<'AttachmentRefView'>;
export type IndexRun = Schema<'IndexRunView'>;
export type KnowledgeStatus = Schema<'KnowledgeStatusView'>;
export type KnowledgeImportResult = Schema<'ImportResultView'>;
export type KnowledgeReindexResult = Schema<'ReindexResultView'>;
