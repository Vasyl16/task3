import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddDisputeCommentDto {
  // The author is NEVER taken from the body — it's the authenticated
  // caller (see DisputesController.addComment).
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  body!: string;
}
