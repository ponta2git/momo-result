import type { SlotKind } from "@/shared/api/enums";

/**
 * SlotKind をキーとする部分関数（ある SlotKind について値があってもなくてもよい）。
 *
 * `Partial<Record<SlotKind, T>>` を 1 か所に集約することで、用途名で読み取りやすくし、
 * 「SlotKind に紐づく値の集まり」を第一級オブジェクトとして扱えるようにする。
 */
export type SlotMap<T> = Partial<Record<SlotKind, T>>;

/**
 * 与えられたエントリ配列から SlotMap を構築する純関数。
 * undefined / null の値は無視する（部分性を保つ）。
 */
export function bySlot<T>(
  entries: ReadonlyArray<readonly [SlotKind, T | undefined | null]>,
): SlotMap<T> {
  const out: SlotMap<T> = {};
  for (const [kind, value] of entries) {
    if (value !== undefined && value !== null) {
      out[kind] = value;
    }
  }
  return out;
}
