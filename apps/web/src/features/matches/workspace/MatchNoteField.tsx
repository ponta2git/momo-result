import {
  matchNoteMaximumCharacters,
  normalizeMatchNote,
} from "@/features/matches/workspace/review/confirmMatchFormSchema";
import { cn } from "@/shared/ui/cn";
import { TextareaControl } from "@/shared/ui/forms/Control";
import { fieldText } from "@/shared/ui/typography";

type MatchNoteFieldProps = {
  error: boolean;
  onChange: (value: string) => void;
  value: string;
};

export function MatchNoteField({ error, onChange, value }: MatchNoteFieldProps) {
  const id = useId();
  const count = Array.from(normalizeMatchNote(value)).length;
  const invalid = error || count > matchNoteMaximumCharacters;
  return (
    <section aria-labelledby={`${id}-label`} className="grid gap-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className={fieldText.label} id={`${id}-label`}>
            試合メモ（任意）
          </h2>
          <p className={cn(fieldText.description, "mt-1")} id={`${id}-help`}>
            印象に残った出来事や、あとで話したいことを残せます。
          </p>
        </div>
        <span
          aria-live="polite"
          className={cn("shrink-0 tabular-nums", invalid ? fieldText.error : fieldText.description)}
        >
          {count} / {matchNoteMaximumCharacters}
        </span>
      </div>
      <TextareaControl
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ""}`}
        data-validation-path="noteBody"
        invalid={invalid}
        minHeight="sm"
        placeholderTone="muted"
        placeholder="例：終盤のカード交換で流れが変わった"
        resize="vertical"
        textFlow="relaxed"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {invalid ? (
        <p className={fieldText.error} id={`${id}-error`} role="alert">
          試合メモは{matchNoteMaximumCharacters}字以内で入力してください。
        </p>
      ) : null}
    </section>
  );
}
import { useId } from "react";
