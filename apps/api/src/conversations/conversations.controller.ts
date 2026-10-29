import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth/auth.decorators';
import { Invalid, MalformedId, NotFound, Secured, UuidParam } from '../common/swagger/api-docs.decorators';
import { ErrorResponse } from '../common/swagger/schema-types';
import { ChatService } from './chat.service';
import { CreateConversationDto, SendMessageDto, UpdateConversationDto } from './conversations.dto';
import { ConversationDetail, ConversationSummary, ConversationView } from './conversations.schemas';
import { ConversationsService } from './conversations.service';
import { BranchDto, FeedbackDto, ToolDto } from '../workspace/workspace.dto';

const ConversationId = () => UuidParam('id', 'Conversation ID owned by the caller.');

@ApiTags('conversations')
@Secured()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService, private readonly chat: ChatService) {}
  @Post(':id/tools') @ApiOperation({ summary: 'Run a selected local tool and save its result in this chat; no inference cost' }) @ApiCreatedResponse()
  @ConversationId() @Invalid({ id: true })
  tool(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ToolDto) { return this.chat.runTool(user, id, dto); }
  @ApiOperation({ summary: 'Create a conversation' })
  @ApiCreatedResponse({ type: ConversationView }) @Invalid()
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) { return this.conversations.create(user, dto.title, dto.projectId); }

  @ApiOperation({ summary: "List the caller's conversations", description: 'Newest first; deleted conversations are excluded. Only the authenticated user\'s conversations are ever returned.' })
  @ApiQuery({ name: 'search', required: false, description: 'Search titles and message content (FTS with substring fallback).' })
  @ApiQuery({ name: 'projectId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'archived', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ type: [ConversationSummary] }) @MalformedId()
  @Get() list(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('projectId', new ParseUUIDPipe({ optional: true })) projectId?: string, @Query('archived') archived?: string) { return this.conversations.list(user, search, projectId, archived === 'true'); }

  @ApiOperation({ summary: 'Get a conversation with its messages' })
  @ConversationId() @ApiOkResponse({ type: ConversationDetail }) @MalformedId() @NotFound('Conversation')
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.conversations.get(user, id); }

  @ApiOperation({ summary: 'Rename, pin, archive or move a conversation to a private project' })
  @ConversationId() @ApiOkResponse({ type: ConversationView }) @Invalid({ id: true }) @NotFound('Conversation')
  @Patch(':id') rename(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto) { return this.conversations.update(user, id, dto); }

  @Post(':id/branch') @ApiOperation({ summary: 'Branch before or after a message without duplicating usage' }) @ApiCreatedResponse({ type: ConversationView })
  @ConversationId() @Invalid({ id: true })
  branch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchDto) { return this.conversations.branch(user, id, dto.messageId, dto.before); }
  @Post(':id/messages/:messageId/feedback') @ApiOperation({ summary: 'Rate an assistant response and optionally leave feedback for admins' }) @ApiOkResponse()
  @ConversationId() @UuidParam('messageId') @Invalid({ id: true })
  feedback(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: FeedbackDto) { return this.conversations.feedback(user, id, messageId, dto.rating, dto.comment); }

  @ApiOperation({ summary: 'Delete a conversation', description: 'Soft delete: hidden from the user, while usage records keep their references.' })
  @ConversationId() @ApiNoContentResponse({ description: 'Deleted.' }) @MalformedId() @NotFound('Conversation')
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.conversations.remove(user, id); }

  @ApiOperation({
    summary: 'Send a message and stream the reply (SSE)',
    description: [
      'Persists the user message, routes the request through the AI gateway, and streams the reply as Server-Sent Events.',
      'Files listed in `attachmentIds` join the files already attached in this chat; their text goes to the model as data. A message may send files without text, and then gets a short overview of them.',
      '',
      '- `event: token` — `data: {"text": "..."}`, repeated',
      '- `event: done` — `data: {"requestId": "...", "messageId": "..."}`',
      '- `event: error` — `data: {"message": "..."}` (provider errors after streaming began)',
      '',
      'Closing the connection cancels generation; the partial reply is kept as INTERRUPTED. Swagger UI shows the raw stream once it completes.',
    ].join('\n'),
  })
  @ConversationId() @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE stream.', content: { 'text/event-stream': { schema: { type: 'string' }, example: 'event: token\ndata: {"text":"This is a mock AI response "}\n\nevent: token\ndata: {"text":"for local POC testing."}\n\nevent: done\ndata: {"requestId":"0b5c2a8e-4b0f-4d0e-9a51-7a3f3f1c2d10","messageId":"5f0f8a5e-0000-4000-8000-000000000001"}\n\n' } } })
  @ApiBadRequestResponse({ description: 'Malformed conversation ID, validation failed, model disabled or unknown, request ID already processed, an attachment that is unknown or not the caller\'s (code ATTACHMENT_NOT_FOUND), the chat\'s files over 60,000 characters (code ATTACHMENT_LIMIT), or the context over the model\'s limit (code CONTEXT_TOO_LONG).', type: ErrorResponse })
  @ApiForbiddenResponse({ description: 'Model not permitted for this user, or external provider not explicitly enabled and configured.', type: ErrorResponse })
  @NotFound('Conversation')
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded, or the daily external-provider limit was reached (local models remain available).', type: ErrorResponse })
  @Post(':id/messages') stream(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Res() response: Response) {
    return this.chat.stream(user, id, dto, response);
  }
}
