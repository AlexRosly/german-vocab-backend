import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateWordDto } from "./dto/create-word.dto";

@Injectable()
export class WordsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.word.findMany({ orderBy: { createdAt: "desc" } });
  }

  findOne(id: string) {
    return this.prisma.word.findUnique({ where: { id } });
  }

  create(dto: CreateWordDto) {
    return this.prisma.word.create({
      data: {
        german: dto.german.trim(),
        article: dto.article,
        grammaticalNumber: dto.grammaticalNumber,
        translation: dto.translation.trim(),
        pluralForm: dto.pluralForm?.trim() || null,
        level: dto.level ?? null,
        lessonNumber: dto.lessonNumber ?? null,
        notes: dto.notes?.trim() || null
      }
    });
  }

  remove(id: string) {
    return this.prisma.word.delete({ where: { id } });
  }
}
