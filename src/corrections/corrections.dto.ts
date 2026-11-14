import { Transform, Type } from "class-transformer";
import { CorrectionCategory, CorrectionStatus } from "@prisma/client";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
const trim = ({value}: {value: unknown}) => typeof value === "string" ? value.normalize("NFC").trim() : value;
export class CorrectionWordParams {
 @IsString() @MinLength(1) @MaxLength(191) @Matches(/^[A-Za-z0-9._-]+$/) wordId!: string;
}
export class CorrectionParams {
 @IsString() @MinLength(1) @MaxLength(191) @Matches(/^[A-Za-z0-9._-]+$/) id!: string;
}
export class CreateCorrectionDto {
 @IsEnum(CorrectionCategory) category!: CorrectionCategory;
 @Transform(trim) @IsString() @MinLength(10) @MaxLength(2000) description!: string;
 @ValidateIf((_object,value) => value !== undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) suggestion?: string;
}
export class CorrectionQueryDto {
 @IsOptional() @IsIn([...Object.values(CorrectionStatus), "ALL"]) status?: CorrectionStatus | "ALL";
 @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) page?: number;
}
export class ReviewCorrectionDto {
 @IsIn([CorrectionStatus.RESOLVED, CorrectionStatus.REJECTED]) status!: "RESOLVED" | "REJECTED";
 @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/) expectedRevision!: string;
 @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) comment!: string;
}
