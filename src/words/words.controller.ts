import { BulkDictionaryDto } from "./dto/bulk-dictionary.dto";
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { CreateWordDto } from "./dto/create-word.dto";
import { UpdateWordDto } from "./dto/update-word.dto";
import { WordQueryDto } from "./dto/word-query.dto";
import { DictionaryEntryParams, SaveDictionaryEntryDto } from "./dto/dictionary-entry.dto";
import { PersonalTranslationsService } from "./personal-translations.service";
import { WordsService } from "./words.service";
import { presentWord } from "../languages/word-presentation";

@ApiTags("words")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("words")
export class WordsController {
  constructor(private readonly wordsService: WordsService, private readonly personalTranslations: PersonalTranslationsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Получить опубликованную библиотеку" })
  async findAll(@CurrentUser() user: AuthUser, @Query() query: WordQueryDto) {
    const words = await this.wordsService.findAll(query.q);
    return words.map((word) => presentWord(word, user.translationLanguage));
  }

  @Get("mine")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Получить свой личный словарь" })
  async findMine(@CurrentUser() user: AuthUser, @Query() query: WordQueryDto) {
    const words = await this.wordsService.findMine(user, query.q);
    return (await this.personalTranslations.present(user, words)).map((word) => ({ ...word, examples: word.examples.map(example => presentWord(example, user.translationLanguage)) }));
  }

  @Post()
  @ApiOperation({ summary: "Создать личную карточку и отправить на проверку" })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateWordDto) {
    return presentWord(await this.wordsService.create(user, dto), user.translationLanguage);
  }

  @Get(":id/dictionary-settings") @Header("Cache-Control", "no-store")
  getDictionaryEntry(@CurrentUser() user: AuthUser, @Param() params: DictionaryEntryParams) { return this.wordsService.getDictionaryEntry(user, params.id); }

  @Put(":id/dictionary-settings") @Header("Cache-Control", "no-store")
  saveDictionaryEntry(@CurrentUser() user: AuthUser, @Param() params: DictionaryEntryParams, @Body() dto: SaveDictionaryEntryDto) { return this.wordsService.saveDictionaryEntry(user, params.id, dto); }

  @Post("dictionary/bulk")
  @HttpCode(200)
  @ApiOperation({ summary: "Добавить найденные опубликованные карточки в свой словарь, сохранив существующие записи" })
  addManyToDictionary(@CurrentUser() user: AuthUser, @Body() dto: BulkDictionaryDto) {
    return this.wordsService.addManyToDictionary(user, dto.wordIds);
  }

  @Post(":id/dictionary")
  @HttpCode(200)
  @ApiOperation({ summary: "Добавить доступную карточку в свой словарь" })
  async addToDictionary(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return presentWord(await this.wordsService.addToDictionary(user, id), user.translationLanguage);
  }

  @Delete(":id/dictionary")
  @ApiOperation({ summary: "Убрать карточку из своего словаря" })
  removeFromDictionary(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.wordsService.removeFromDictionary(user, id);
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Получить опубликованную или свою карточку" })
  async findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return presentWord(await this.wordsService.findOne(user, id), user.translationLanguage);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Изменить свою неопубликованную карточку или карточку как администратор" })
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateWordDto) {
    return presentWord(await this.wordsService.update(user, id, dto), user.translationLanguage);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Убрать карточку из своего словаря (совместимый маршрут)" })
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.wordsService.removeFromDictionary(user, id);
  }
}
