import { Filter } from "lucide-react";
import { Button, Field, FilterBar, InputControl, SelectField } from "momo-result-ui";

const noop = () => {};

const seasonOptions = [
  { value: "2026", label: "2026年シーズン" },
  { value: "2025", label: "2025年シーズン" },
];
const mapOptions = [
  { value: "all", label: "すべてのマップ" },
  { value: "japan", label: "日本マップ" },
  { value: "world", label: "世界マップ" },
];

export const Basic = () => (
  <FilterBar
    ariaLabel="採点基準の比較条件"
    meta="比較対象 24試合・12開催"
    primary={
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="比較するシーズン"
          options={seasonOptions}
          value="2026"
          onValueChange={noop}
        />
        <SelectField
          label="比較するマップ"
          options={mapOptions}
          value="japan"
          onValueChange={noop}
        />
      </div>
    }
    resetAction={
      <Button size="sm" variant="quiet">
        全期間・全マップで比較する
      </Button>
    }
  />
);

export const WithDetailsOpen = () => (
  <FilterBar
    ariaLabel="試合の表示条件"
    details={{
      align: "end",
      columns: 2,
      controls: (
        <>
          <Field htmlFor="filter-player" label="プレイヤー名">
            <InputControl defaultValue="ももたろう" id="filter-player" type="search" />
          </Field>
          <SelectField label="マップ" options={mapOptions} value="japan" onValueChange={noop} />
        </>
      ),
      label: (
        <span className="inline-flex items-center gap-2">
          <Filter aria-hidden="true" className="size-4 shrink-0" />
          詳細条件
        </span>
      ),
      open: true,
      summary: "ももたろう・日本マップ",
    }}
    primary={
      <SelectField
        label="並び順"
        options={[
          { value: "new", label: "開催日が新しい順" },
          { value: "old", label: "開催日が古い順" },
        ]}
        value="new"
        onValueChange={noop}
      />
    }
    resetAction={
      <Button size="sm" variant="quiet">
        初期条件へ戻す
      </Button>
    }
  />
);

export const DetailsCollapsed = () => (
  <FilterBar
    ariaLabel="試合の表示条件"
    details={{
      controls: (
        <SelectField label="マップ" options={mapOptions} value="all" onValueChange={noop} />
      ),
      label: "詳細条件",
      open: false,
      summary: "世界マップ・50年",
    }}
    primary={
      <SelectField label="シーズン" options={seasonOptions} value="2026" onValueChange={noop} />
    }
  />
);
