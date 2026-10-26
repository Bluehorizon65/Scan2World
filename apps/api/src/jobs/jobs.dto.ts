import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class ReconstructionConfigDto {
  @IsOptional()
  @IsIn(['draft', 'balanced', 'high'])
  quality: 'draft' | 'balanced' | 'high' = 'balanced';

  /** exhaustive: robust for unordered photos; sequential: faster for video-like ordered captures. */
  @IsOptional()
  @IsIn(['exhaustive', 'sequential'])
  matcher: 'exhaustive' | 'sequential' = 'exhaustive';

  /** Request dense reconstruction; only honoured when the recon service has a GPU. */
  @IsOptional()
  @IsBoolean()
  dense = true;
}
