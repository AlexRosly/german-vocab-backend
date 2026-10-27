import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateWordExampleDto } from "./dto/create-word-example.dto";
import { UpdateWordExampleDto } from "./dto/update-word-example.dto";

@Injectable()
export class WordExamplesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(wordId: string) {
    await this.ensureWordExists(wordId);

    return this.prisma.wordExample.findMany({
      where: { wordId },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(wordId: string, dto: CreateWordExampleDto) {
    await this.ensureWordExists(wordId);

    return this.prisma.wordExample.create({
      data: {
        wordId,
        german: dto.german,
        translation: dto.translation,
      },
    });
  }

  async update(
    wordId: string,
    exampleId: string,
    dto: UpdateWordExampleDto,
  ) {
    await this.ensureWordExists(wordId);
    await this.ensureExampleExists(wordId, exampleId);

    return this.prisma.wordExample.update({
      where: { id: exampleId },
      data: dto,
    });
  }

  async remove(wordId: string, exampleId: string) {
    await this.ensureWordExists(wordId);
    await this.ensureExampleExists(wordId, exampleId);

    return this.prisma.wordExample.delete({
      where: { id: exampleId },
    });
  }

  private async ensureWordExists(wordId: string) {
    const word = await this.prisma.word.findUnique({
      where: { id: wordId },
      select: { id: true },
    });

    if (!word) {
      throw new NotFoundException("Word not found");
    }
  }

  private async ensureExampleExists(wordId: string, exampleId: string) {
    const example = await this.prisma.wordExample.findFirst({
      where: { id: exampleId, wordId },
      select: { id: true },
    });

    if (!example) {
      throw new NotFoundException("Example not found");
    }
  }
}