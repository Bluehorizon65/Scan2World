import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OpDto {
  @IsIn(['align_floor', 'scale', 'simplify', 'remove_small_components'])
  op!: 'align_floor' | 'scale' | 'simplify' | 'remove_small_components';

  @ValidateIf((o: OpDto) => o.op === 'scale')
  @IsNumber()
  @IsPositive()
  @Max(1000)
  factor?: number;

  @ValidateIf((o: OpDto) => o.op === 'simplify')
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  targetTriangles?: number;

  @ValidateIf((o: OpDto) => o.op === 'remove_small_components' && o.minFaceRatio !== undefined)
  @IsNumber()
  @Min(0.0001)
  @Max(1)
  minFaceRatio?: number;
}

export class ProcessDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpDto)
  ops!: OpDto[];
}

export class GamemapDto {
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(500_000)
  collisionTargetTriangles = 5000;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(60)
  maxSlopeDeg = 35;
}

export class ExportDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['glb', 'obj', 'ply'], { each: true })
  formats!: ('glb' | 'obj' | 'ply')[];

  @IsOptional()
  @IsBoolean()
  includeCollision = true;

  @IsOptional()
  @IsBoolean()
  includeWalkable = true;
}
