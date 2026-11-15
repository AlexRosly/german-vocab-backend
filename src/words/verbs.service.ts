import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { PersonalTranslationsService } from "./personal-translations.service";
import { dictionaryWords, readableWords, WORD_INCLUDE } from "./word-access.service";
import { VerbQueryDto } from "./dto/verb-query.dto";

const PAGE_SIZE = 30;
function include(userId: string) {
  return { ...WORD_INCLUDE, userWords: { where: { userId }, select: { id: true } } } satisfies Prisma.WordInclude;
}
type Row = Prisma.WordGetPayload<{ include: ReturnType<typeof include> }>;

@Injectable()
export class VerbsService {
  constructor(private readonly prisma: PrismaService, private readonly personal: PersonalTranslationsService) {}
  private async present(user: AuthUser, words: Row[]) {
    const presented = await this.personal.present(user, words);
    return presented.map(word => ({ id: word.id, german: word.german, notes: word.notes,
      publicationStatus: word.publicationStatus, selectedTranslation: word.selectedTranslation,
      sourceBook: word.sourceBook, bookSources: word.bookSources, isInDictionary: word.userWords.length > 0,
      verbForms: word.verbForms.map(({praeteritum,participle2,auxiliary,reflexive,usage}) => ({praeteritum,participle2,auxiliary,reflexive,usage})),
    }));
  }
  async list(user: AuthUser, query: VerbQueryDto) {
    const where: Prisma.WordWhereInput = { AND: [
      query.scope === "mine" ? { AND: [dictionaryWords(user.id), { userWords: { some: { userId: user.id } } }] } : { publicationStatus: "PUBLISHED" },
      { verbForms: { some: query.auxiliary ? { auxiliary: query.auxiliary } : {} } },
      query.q ? { OR: [ { german: { contains: query.q, mode: "insensitive" } },
        { verbForms: { some: { OR: [ { praeteritum: { contains: query.q, mode: "insensitive" } }, { participle2: { contains: query.q, mode: "insensitive" } } ] } } },
      ] } : {},
    ] };
    const { total, words } = await this.prisma.$transaction(async tx => ({
      total: await tx.word.count({ where }),
      words: await tx.word.findMany({ where, include: include(user.id), orderBy: [{ german: "asc" }, { id: "asc" }], skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    }), { isolationLevel: "RepeatableRead", timeout: 20000 });
    return { total, page: query.page, pageSize: PAGE_SIZE, hasNext: query.page * PAGE_SIZE < total, items: await this.present(user, words) };
  }
  async detail(user: AuthUser, id: string) {
    const word = await this.prisma.word.findFirst({ where: { AND: [{id}, readableWords(user), {verbForms:{some:{}}}] }, include: include(user.id) });
    if (!word) throw new NotFoundException("Глагол недоступен");
    return (await this.present(user, [word]))[0];
  }
}
