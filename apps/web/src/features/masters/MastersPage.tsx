import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { layoutFamilies } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";
import {
  createGameTitle,
  createMapMaster,
  createSeasonMaster,
  listGameTitles,
  listIncidentMasters,
  listMapMasters,
  listSeasonMasters,
} from "@/shared/api/masters";
import type {
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

const inputClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100 transition hover:border-white/18";
const labelClass = "text-xs font-bold tracking-[0.22em] text-ink-300 uppercase";

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const normalized = normalizeUnknownApiError(error);
  return (
    <p role="alert" className="text-rail-magenta text-xs">
      {normalized.detail || normalized.title}
    </p>
  );
}

function GameTitlesSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["masters", "game-titles"],
    queryFn: listGameTitles,
  });
  const items = data?.items ?? [];
  const [draft, setDraft] = useState<{ name: string; layoutFamily: LayoutFamily }>({
    name: "",
    layoutFamily: layoutFamilies[0],
  });
  const mutation = useMutation({
    mutationFn: createGameTitle,
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["masters", "game-titles"] });
      setDraft({ name: "", layoutFamily: layoutFamilies[0] });
    },
  });

  return (
    <Card>
      <header>
        <p className={labelClass}>Game Titles</p>
        <h2 className="mt-1 text-xl font-black">作品マスタ</h2>
      </header>
      <ul className="mt-4 grid gap-2">
        {items.length === 0 ? (
          <li className="text-ink-400 text-sm">まだ登録されていません。</li>
        ) : (
          items.map((item: GameTitleResponse) => (
            <li
              key={item.id}
              className="border-line-soft bg-capture-black/24 flex items-center justify-between rounded-2xl border px-3 py-2 text-sm"
            >
              <span className="text-ink-100 font-bold">{item.name}</span>
              <span className="text-ink-400 text-xs">
                {item.layoutFamily} / {item.id}
              </span>
            </li>
          ))
        )}
      </ul>
      <form
        className="mt-4 grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.name.trim()) return;
          mutation.mutate({
            id: `gt_${slugify(draft.name)}_${Date.now()}`,
            name: draft.name.trim(),
            layoutFamily: draft.layoutFamily,
          });
        }}
      >
        <label className="grid gap-2">
          <span className={labelClass}>作品名</span>
          <input
            className={inputClass}
            placeholder="例: 桃太郎電鉄2"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="grid gap-2">
          <span className={labelClass}>Layout Family</span>
          <select
            className={inputClass}
            value={draft.layoutFamily}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                layoutFamily: event.target.value as LayoutFamily,
              }))
            }
          >
            {layoutFamilies.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={!draft.name.trim() || mutation.isPending}>
          追加
        </Button>
        <div className="md:col-span-3">
          <ErrorNotice error={mutation.error} />
        </div>
      </form>
    </Card>
  );
}

function ScopedMasterSection({
  title,
  label,
  queryKey,
  listFn,
  createFn,
  gameTitles,
}: {
  title: string;
  label: string;
  queryKey: string;
  listFn: (gameTitleId?: string) => Promise<{ items?: { id: string; name: string }[] }>;
  createFn: (request: {
    id: string;
    gameTitleId: string;
    name: string;
  }) => Promise<MapMasterResponse | SeasonMasterResponse>;
  gameTitles: GameTitleResponse[];
}) {
  const queryClient = useQueryClient();
  const [selectedGameTitleId, setSelectedGameTitleId] = useState<string>(gameTitles[0]?.id ?? "");
  useEffect(() => {
    if (gameTitles.length === 0) return;
    const exists = gameTitles.some((gt) => gt.id === selectedGameTitleId);
    if (!exists) {
      setSelectedGameTitleId(gameTitles[0]!.id);
    }
  }, [gameTitles, selectedGameTitleId]);
  const { data } = useQuery({
    queryKey: ["masters", queryKey, selectedGameTitleId],
    queryFn: () => listFn(selectedGameTitleId || undefined),
    enabled: gameTitles.length > 0 && Boolean(selectedGameTitleId),
  });
  const items = data?.items ?? [];
  const [name, setName] = useState("");
  const mutation = useMutation({
    mutationFn: createFn,
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["masters", queryKey] });
      setName("");
    },
  });

  return (
    <Card>
      <header>
        <p className={labelClass}>{label}</p>
        <h2 className="mt-1 text-xl font-black">{title}</h2>
      </header>
      {gameTitles.length === 0 ? (
        <p className="text-ink-400 mt-4 text-sm">先に作品マスタを追加してください。</p>
      ) : (
        <>
          <label className="mt-4 grid gap-2 md:max-w-sm">
            <span className={labelClass}>作品で絞り込み</span>
            <select
              className={inputClass}
              value={selectedGameTitleId}
              onChange={(event) => setSelectedGameTitleId(event.target.value)}
            >
              {gameTitles.map((gameTitle) => (
                <option key={gameTitle.id} value={gameTitle.id}>
                  {gameTitle.name}
                </option>
              ))}
            </select>
          </label>
          <ul className="mt-4 grid gap-2">
            {items.length === 0 ? (
              <li className="text-ink-400 text-sm">この作品にはまだ登録がありません。</li>
            ) : (
              items.map((item) => (
                <li
                  key={item.id}
                  className="border-line-soft bg-capture-black/24 flex items-center justify-between rounded-2xl border px-3 py-2 text-sm"
                >
                  <span className="text-ink-100 font-bold">{item.name}</span>
                  <span className="text-ink-400 text-xs">{item.id}</span>
                </li>
              ))
            )}
          </ul>
          <form
            className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !selectedGameTitleId) return;
              mutation.mutate({
                id: `${queryKey.replace(/-/g, "_")}_${slugify(name)}_${Date.now()}`,
                gameTitleId: selectedGameTitleId,
                name: name.trim(),
              });
            }}
          >
            <label className="grid gap-2">
              <span className={labelClass}>名称</span>
              <input
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={!name.trim() || mutation.isPending}>
              追加
            </Button>
            <div className="md:col-span-2">
              <ErrorNotice error={mutation.error} />
            </div>
          </form>
        </>
      )}
    </Card>
  );
}

function IncidentMastersSection() {
  const { data } = useQuery({
    queryKey: ["masters", "incident-masters"],
    queryFn: listIncidentMasters,
  });
  const items = data?.items ?? [];
  return (
    <Card>
      <header>
        <p className={labelClass}>Incident Masters</p>
        <h2 className="mt-1 text-xl font-black">事件簿マスタ（読み取り専用）</h2>
      </header>
      <p className="text-ink-400 mt-2 text-xs">MVP では 6 項目固定。追加・編集はできません。</p>
      <ul className="mt-4 grid gap-2">
        {items.length === 0 ? (
          <li className="text-ink-400 text-sm">読み込み中…</li>
        ) : (
          items.map((item: IncidentMasterResponse) => (
            <li
              key={item.id}
              className="border-line-soft bg-capture-black/24 flex items-center justify-between rounded-2xl border px-3 py-2 text-sm"
            >
              <span className="text-ink-100 font-bold">{item.displayName}</span>
              <span className="text-ink-400 text-xs">{item.key}</span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

export function MastersPage() {
  const { data: gameTitlesData } = useQuery({
    queryKey: ["masters", "game-titles"],
    queryFn: listGameTitles,
  });
  const gameTitles = gameTitlesData?.items ?? [];

  return (
    <main className="mx-auto grid max-w-5xl gap-5 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className={labelClass}>Admin</p>
          <h1 className="mt-1 text-3xl font-black">マスタ管理</h1>
          <p className="text-ink-400 mt-2 text-sm">
            作品・マップ・シーズン・事件簿のマスタを管理します。
          </p>
        </div>
        <Link className="text-ink-300 hover:text-ink-100 text-sm underline" to="/ocr/new">
          取り込みコンソールへ戻る
        </Link>
      </div>
      <GameTitlesSection />
      <ScopedMasterSection
        title="マップマスタ"
        label="Map Masters"
        queryKey="map-masters"
        listFn={listMapMasters}
        createFn={createMapMaster}
        gameTitles={gameTitles}
      />
      <ScopedMasterSection
        title="シーズンマスタ"
        label="Season Masters"
        queryKey="season-masters"
        listFn={listSeasonMasters}
        createFn={createSeasonMaster}
        gameTitles={gameTitles}
      />
      <IncidentMastersSection />
    </main>
  );
}
