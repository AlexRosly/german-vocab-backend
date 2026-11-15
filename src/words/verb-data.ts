import { BadRequestException } from "@nestjs/common";
import { VerbFormDto } from "./dto/verb-form.dto";

type Card = { article: string; grammaticalNumber: string; pluralForm?: string | null };
type Input = { isVerb?: boolean; verbForms?: VerbFormDto[] };
type SavedForm = Omit<VerbFormDto, "auxiliary"> & { auxiliary: "HABEN" | "SEIN" };

// Absence on PATCH preserves existing forms. Only an explicit isVerb:false removes them.
export function verbData(input: Input, card: Card, existing: SavedForm[] = [], creating = false) {
  const specified = input.isVerb !== undefined || input.verbForms !== undefined;
  if (input.isVerb === false && input.verbForms?.length) throw new BadRequestException("Уберите формы или отметьте «Глагол»");
  const forms = input.isVerb === false ? [] : input.verbForms ?? existing;
  const isVerb = input.isVerb === true || forms.length > 0;
  if (isVerb && (forms.length < 1 || forms.length > 4)) throw new BadRequestException("Для глагола нужны Präteritum, Partizip II и haben/sein (до четырёх вариантов)");
  if (specified && input.isVerb !== false && !isVerb) throw new BadRequestException("Чтобы убрать формы, явно снимите отметку «Глагол»");
  if (isVerb && (card.article !== "none" || card.grammaticalNumber !== "not_applicable" || card.pluralForm)) {
    throw new BadRequestException("У глагола не может быть артикля или множественного числа");
  }
  const normalized = forms.map((form, position) => ({ position,
    praeteritum: form.praeteritum.normalize("NFC").trim().replace(/\s+/gu, " "),
    participle2: form.participle2.normalize("NFC").trim().replace(/\s+/gu, " "),
    auxiliary: form.auxiliary, reflexive: form.reflexive ?? false,
    usage: form.usage?.normalize("NFC").trim().replace(/\s+/gu, " ") || null,
  }));
  if (new Set(normalized.map(({ position: _, ...form }) => JSON.stringify(form))).size !== normalized.length) {
    throw new BadRequestException("Одинаковые варианты форм не нужно добавлять дважды");
  }
  return creating ? { create: normalized } : specified ? { deleteMany: {}, create: normalized } : undefined;
}
