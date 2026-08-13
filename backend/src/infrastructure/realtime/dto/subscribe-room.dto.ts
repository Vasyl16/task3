import { IsString, Matches, MaxLength } from 'class-validator';

// Gateway messages get a validated DTO exactly like controller bodies do
// (see .claude/rules/backend.md) — a WebSocket frame is untrusted client
// input in precisely the same way an HTTP body is. The regex is a coarse
// shape check; parseRoom does the authoritative parse, and
// RealtimeRoomsService does the authorization.
export class SubscribeRoomDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-z-]+:[A-Za-z0-9-]+$/, {
    message: 'room must look like "{type}:{id}", e.g. "auction:abc123"',
  })
  room!: string;
}
