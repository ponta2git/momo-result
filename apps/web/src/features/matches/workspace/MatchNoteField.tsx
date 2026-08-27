import {
  matchNoteMaximumCharacters,
  normalizeMatchNote,
} from "@/features/matches/workspace/review/confirmMatchFormSchema";
import { cn } from "@/shared/ui/cn";
import { TextareaControl } from "@/shared/ui/forms/Control";

type MatchNoteFieldProps = {
  error: boolean;
  onChange: (value: string) => void;
  value: string;
};

export function MatchNoteField({ error, onChange, value }: MatchNoteFieldProps) {
  const count = Array.from(normalizeMatchNote(value)).length;
  const invalid = error || count > matchNoteMaximumCharacters;
  return (
    <section
      aria-labelledby="match-note-field-heading"
      className="grid gap-2 border-t border-[var(--color-border)] pt-4"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2
            className="text-sm font-semibold text-[var(--color-text-primary)]"
            id="match-note-field-heading"
          >
            試合メモ（任意）
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            印象に残った出来事や、あとで話したいことを残せます。
          </p>
        </div>
        <span
          aria-live="polite"
          className={cn(
            "shrink-0 text-xs tabular-nums",
            invalid
              ? "font-semibold text-[var(--color-danger)]"
              : "text-[var(--color-text-secondary)]",
          )}
        >
          {count} / {matchNoteMaximumCharacters}
        </span>
      </div>
      <TextareaControl
        aria-label="試合メモ（任意）"
        aria-describedby={invalid ? "match-note-error" : undefined}
        className={cn("min-h-24 resize-y leading-6 placeholder:text-[var(--color-text-muted)]")}
        invalid={invalid}
        placeholder="例：終盤のカード交換で流れが変わった"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {invalid ? (
        <p
          className="text-xs font-semibold text-[var(--color-danger)]"
          id="match-note-error"
          role="alert"
        >
          試合メモは{matchNoteMaximumCharacters}字以内で入力してください。
        </p>
      ) : null}
    </section>
  );
}
