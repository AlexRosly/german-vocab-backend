import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { WordExamplesService } from "./word-examples.service";
import { CreateWordExampleDto } from "./dto/create-word-example.dto";
import { UpdateWordExampleDto } from "./dto/update-word-example.dto";

@ApiTags("word-examples")
@Controller("words/:wordId/examples")
export class WordExamplesController {
  constructor(private readonly wordExamplesService: WordExamplesService) {}

  @Get()
  @ApiOperation({ summary: "Get examples for a word" })
  list(@Param("wordId") wordId: string) {
    return this.wordExamplesService.list(wordId);
  }

  @Post()
  @ApiOperation({ summary: "Create an example for a word" })
  create(
    @Param("wordId") wordId: string,
    @Body() dto: CreateWordExampleDto,
  ) {
    return this.wordExamplesService.create(wordId, dto);
  }

  @Patch(":exampleId")
  @ApiOperation({ summary: "Update a word example" })
  update(
    @Param("wordId") wordId: string,
    @Param("exampleId") exampleId: string,
    @Body() dto: UpdateWordExampleDto,
  ) {
    return this.wordExamplesService.update(wordId, exampleId, dto);
  }

  @Delete(":exampleId")
  @ApiOperation({ summary: "Delete a word example" })
  remove(
    @Param("wordId") wordId: string,
    @Param("exampleId") exampleId: string,
  ) {
    return this.wordExamplesService.remove(wordId, exampleId);
  }
}