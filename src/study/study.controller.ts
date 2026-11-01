import { Body, Controller, Get, Header, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { StudyService } from "./study.service";
import { CreateStudySessionDto } from "./dto/create-study-session.dto";
import { StudyHistoryQueryDto } from "./dto/study-history-query.dto";
import { presentWord } from "../languages/word-presentation";

@ApiTags("study")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("study")
export class StudyController {
  constructor(private readonly studyService: StudyService) {}

  @Post("sessions")
  @Header("Cache-Control", "no-store")
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Уникальный ключ сохранения сессии, 8–128 символов ASCII" })
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStudySessionDto,
    @Headers("idempotency-key") requestKey?: string,
  ) {
    return this.presentSession(await this.studyService.createSession(user.id, dto, requestKey), user.translationLanguage);
  }

  @Get("sessions")
  @Header("Cache-Control", "no-store")
  async getSessions(@CurrentUser() user: AuthUser) {
    const sessions = await this.studyService.getSessions(user.id);
    return sessions.map((session) => this.presentSession(session, user.translationLanguage));
  }

  @Get("history")
  @Header("Cache-Control", "no-store")
  getHistory(@CurrentUser() user: AuthUser, @Query() query: StudyHistoryQueryDto) {
    return this.studyService.getHistory(user.id, query);
  }

  @Get("history/:id")
  @Header("Cache-Control", "no-store")
  async getHistorySession(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.presentSession(await this.studyService.getHistorySession(user.id, id), user.translationLanguage);
  }

  @Get("progress")
  @Header("Cache-Control", "no-store")
  async getProgress(@CurrentUser() user: AuthUser) {
    const progress = await this.studyService.getProgress(user.id);
    return { ...progress, words: progress.words.map((item) => ({ ...item, word: presentWord(item.word, user.translationLanguage) })) };
  }

  @Get("due")
  @Header("Cache-Control", "no-store")
  async getDueWords(@CurrentUser() user: AuthUser) {
    const result = await this.studyService.getDueWords(user.id);
    return { ...result, words: result.words.map((word) => presentWord(word, user.translationLanguage)) };
  }

  @Get("new")
  @Header("Cache-Control", "no-store")
  async getNewWords(@CurrentUser() user: AuthUser) {
    const result = await this.studyService.getNewWords(user.id);
    return { ...result, words: result.words.map((word) => presentWord(word, user.translationLanguage)) };
  }

  private presentSession(session: Awaited<ReturnType<StudyService["createSession"]>>, language: string) {
    return { ...session, words: session.words.map((item) => ({ ...item, word: presentWord(item.word, language) })) };
  }
}
