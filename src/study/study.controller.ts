import { Body, Controller, Get, Header, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { StudyService } from "./study.service";
import { CreateStudySessionDto } from "./dto/create-study-session.dto";
import { StudyHistoryQueryDto } from "./dto/study-history-query.dto";
import { PersonalTranslationsService } from "../words/personal-translations.service";

@ApiTags("study")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("study")
export class StudyController {
  constructor(private readonly studyService: StudyService, private readonly personalTranslations: PersonalTranslationsService) {}

  @Post("sessions")
  @Header("Cache-Control", "no-store")
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Уникальный ключ сохранения сессии, 8–128 символов ASCII" })
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStudySessionDto,
    @Headers("idempotency-key") requestKey?: string,
  ) {
    return this.presentSession(await this.studyService.createSession(user.id, dto, requestKey), user);
  }

  @Get("sessions")
  @Header("Cache-Control", "no-store")
  async getSessions(@CurrentUser() user: AuthUser) {
    const sessions = await this.studyService.getSessions(user.id);
    return Promise.all(sessions.map((session) => this.presentSession(session, user)));
  }

  @Get("history")
  @Header("Cache-Control", "no-store")
  getHistory(@CurrentUser() user: AuthUser, @Query() query: StudyHistoryQueryDto) {
    return this.studyService.getHistory(user.id, query);
  }

  @Get("history/:id")
  @Header("Cache-Control", "no-store")
  async getHistorySession(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.presentSession(await this.studyService.getHistorySession(user.id, id), user);
  }

  @Get("progress")
  @Header("Cache-Control", "no-store")
  async getProgress(@CurrentUser() user: AuthUser) {
    const progress = await this.studyService.getProgress(user.id);
    const words = await this.personalTranslations.present(user, progress.words.map(item => item.word));
    return { ...progress, words: progress.words.map((item, index) => ({ ...item, word: words[index] })) };
  }

  @Get("due")
  @Header("Cache-Control", "no-store")
  async getDueWords(@CurrentUser() user: AuthUser) {
    const result = await this.studyService.getDueWords(user.id);
    return { ...result, words: await this.personalTranslations.present(user, result.words) };
  }

  @Get("new")
  @Header("Cache-Control", "no-store")
  async getNewWords(@CurrentUser() user: AuthUser) {
    const result = await this.studyService.getNewWords(user.id);
    return { ...result, words: await this.personalTranslations.present(user, result.words) };
  }

  private async presentSession(session: Awaited<ReturnType<StudyService["createSession"]>>, user: AuthUser) {
    const words = await this.personalTranslations.present(user, session.words.map(item => item.word));
    return { ...session, words: session.words.map((item, index) => ({ ...item, word: words[index] })) };
  }
}
