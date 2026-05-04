import { slotKinds } from "@/shared/api/enums";
import type { SlotKind } from "@/shared/api/enums";

/**
 * SlotKind をキーとする部分関数（ある SlotKind について値があってもなくてもよい）。
 *
 * `Partial<Record<SlotKind, T>>` を 1 か所に集約することで、用途名で読み取りやすくし、
 * 後続のヘルパ（`bySlot`, `mapSlots`, `forEachSlot`）と組み合わせて
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

/** SlotMap の各値に純関数を適用して新しい SlotMap を作る。元の SlotMap は変更しない。 */
export function mapSlots<T, U>(map: SlotMap<T>, fn: (value: T, kind: SlotKind) => U): SlotMap<U> {
  const out: SlotMap<U> = {};
  for (const kind of slotKinds) {
    const value = map[kind];
    if (value !== undefined) {
      out[kind] = fn(value, kind);
    }
  }
  return out;
}

/** SlotMap の各値に副作用を適用する。順序は `slotKinds` の宣言順。 */
export function forEachSlot<T>(map: SlotMap<T>, fn: (value: T, kind: SlotKind) => void): void {
  for (const kind of slotKinds) {
    const value = map[kind];
    if (value !== undefined) {
      fn(value, kind);
    }
  }
}

/** SlotMap を `[kind, value]` の配列に整列して取り出す。順序は `slotKinds` の宣言順。 */
export function slotEntries<T>(map: SlotMap<T>): Array<[SlotKind, T]> {
  const out: Array<[SlotKind, T]> = [];
  for (const kind of slotKinds) {
    const value = map[kind];
    if (value !== undefined) {
      out.push([kind, value]);
    }
  }
  return out;
}
