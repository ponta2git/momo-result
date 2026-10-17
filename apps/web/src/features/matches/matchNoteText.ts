export const matchNoteMaximumCharacters = 150;

export function normalizeMatchNote(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
