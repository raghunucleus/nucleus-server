import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Longest a single chat message may be. Generous for greetings/conversation
// while still bounding the row size and any abuse.
export const MAX_MESSAGE_LENGTH = 4000;

// ---------------------------------------------------------------------------
// REST body
// ---------------------------------------------------------------------------

/** Body of POST /student/chat/conversations — the student to start a chat with. */
export const StartConversationSchema = z.object({
  studentId: z.number().int().positive(),
});

export class StartConversationDto extends createZodDto(StartConversationSchema) {}

/**
 * Body of POST /student/chat/conversations/:id/accept — accept an incoming
 * request, optionally muting it in the same step ("Accept + Mute").
 */
export const AcceptRequestSchema = z.object({
  mute: z.boolean().optional(),
});

export class AcceptRequestDto extends createZodDto(AcceptRequestSchema) {}

// ---------------------------------------------------------------------------
// Socket event payloads (validated in the gateway with safeParse)
// ---------------------------------------------------------------------------

export const SendMessageSchema = z.object({
  toStudentId: z.number().int().positive(),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  /** Client-generated id echoed back in the ack so the optimistic row reconciles. */
  clientTempId: z.string().min(1).max(64).optional(),
});
export type SendMessagePayload = z.infer<typeof SendMessageSchema>;

export const ConversationRefSchema = z.object({
  conversationId: z.number().int().positive(),
});
export type ConversationRefPayload = z.infer<typeof ConversationRefSchema>;
