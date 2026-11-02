import { IsString, Length, Matches } from "class-validator";
export class RelationWordParams {
  @IsString() @Length(1, 191) @Matches(/^[A-Za-z0-9._-]+$/) id!: string;
}
export class RelationPairParams extends RelationWordParams {
  @IsString() @Length(1, 191) @Matches(/^[A-Za-z0-9._-]+$/) relatedId!: string;
}
