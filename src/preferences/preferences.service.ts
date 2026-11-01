import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { INTERFACE_LANGUAGE_CODES, normalizeLanguage, translationLanguage } from "../languages/language-options";
import { PrismaService } from "../prisma.service";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";

const PREFERENCES_SELECT = { interfaceLanguage: true, translationLanguage: true } satisfies Prisma.UserSelect;

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const preferences = await this.prisma.user.findUnique({ where: { id: userId }, select: PREFERENCES_SELECT });
    if (!preferences) throw new NotFoundException("Пользователь не найден");
    return preferences;
  }

  update(userId: string, dto: UpdatePreferencesDto) {
    if (!dto || typeof dto !== "object") throw new BadRequestException("Укажите языковые настройки");
    const data: { interfaceLanguage?: string; translationLanguage?: string } = {};
    if (dto.interfaceLanguage !== undefined) {
      const language = normalizeLanguage(dto.interfaceLanguage);
      if (typeof language !== "string" || !INTERFACE_LANGUAGE_CODES.includes(language)) {
        throw new BadRequestException("Неподдерживаемый язык интерфейса");
      }
      data.interfaceLanguage = language;
    }
    if (dto.translationLanguage !== undefined) data.translationLanguage = translationLanguage(dto.translationLanguage);
    if (Object.keys(data).length === 0) throw new BadRequestException("Укажите хотя бы одну языковую настройку");
    return this.prisma.user.update({ where: { id: userId }, data, select: PREFERENCES_SELECT });
  }
}
