import { Body, Controller, Get, Param, ParseIntPipe, Post, Delete, NotFoundException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateWordDto } from "./dto/create-word.dto";
import { WordsService } from "./words.service";

@ApiTags("words")
@Controller("words")
export class WordsController {
  constructor(private readonly wordsService: WordsService) {}

  @Get()
  @ApiOperation({ summary: "Получить список карточек" })
  findAll() {
    return this.wordsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: "Создать карточку" })
  create(@Body() dto: CreateWordDto) {
    return this.wordsService.create(dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Получить карточку по ID" })
  async findOne(@Param("id") id: string) {
    const word = await this.wordsService.findOne(id);
    if (!word) throw new NotFoundException("Карточка не найдена");
    return word;
  }

  @Delete(":id")
  @ApiOperation({ summary: "Удалить карточку" })
  async remove(@Param("id") id: string) {
    const word = await this.wordsService.findOne(id);
    if (!word) throw new NotFoundException("Карточка не найдена");
    await this.wordsService.remove(id);
    return { deleted: true };
  }
}
