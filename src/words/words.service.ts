import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateWordDto } from "./dto/create-word.dto";
import { UpdateWordDto } from "./dto/update-word.dto";

@Injectable()
export class WordsService {
  constructor(private readonly prisma: PrismaService) {}
  findAll() { return this.prisma.word.findMany({ orderBy: { createdAt: "desc" } }); }
  findOne(id: string) { return this.prisma.word.findUnique({ where: { id } }); }
  create(dto: CreateWordDto) {
    return this.prisma.word.create({ data: {
      german: dto.german.trim(), article: dto.article, grammaticalNumber: dto.grammaticalNumber,
      translation: dto.translation.trim(), pluralForm: dto.pluralForm?.trim() || null,
      level: dto.level ?? null, lessonNumber: dto.lessonNumber ?? null, notes: dto.notes?.trim() || null
    }});
  }
  update(id: string, dto: UpdateWordDto) {
    return this.prisma.word.update({ where: { id }, data: {
      ...(dto.german !== undefined ? { german: dto.german.trim() } : {}),
      ...(dto.article !== undefined ? { article: dto.article } : {}),
      ...(dto.grammaticalNumber !== undefined ? { grammaticalNumber: dto.grammaticalNumber } : {}),
      ...(dto.translation !== undefined ? { translation: dto.translation.trim() } : {}),
      ...(dto.pluralForm !== undefined ? { pluralForm: dto.pluralForm.trim() || null } : {}),
      ...(dto.level !== undefined ? { level: dto.level ?? null } : {}),
      ...(dto.lessonNumber !== undefined ? { lessonNumber: dto.lessonNumber ?? null } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {})
    }});
  }
  remove(id: string) { return this.prisma.word.delete({ where: { id } }); }
}
