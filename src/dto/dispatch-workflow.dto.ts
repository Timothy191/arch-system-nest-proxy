import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class DispatchWorkflowDto {
  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  nodes?: Record<string, any>[];

  @IsOptional()
  @IsArray()
  edges?: Record<string, any>[];

  @IsOptional()
  @IsString()
  triggeredBy?: string;

  /**
   * Client-supplied idempotency key. When present it becomes part of the
   * BullMQ job id (`idem_<key>`), so retried dispatches with the same key
   * are deduplicated by the queue instead of creating duplicate jobs.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'idempotencyKey may only contain [A-Za-z0-9._:-]',
  })
  idempotencyKey?: string;
}
