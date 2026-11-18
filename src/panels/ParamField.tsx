/**
 * Поле параметра (5.2, 5.3): единицы, подсказка «что это и на что влияет», проверка при вводе,
 * блокировка параметров, которые нельзя менять во время запуска.
 */
import { Info, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input, Label, Select, Tip } from '@/components/ui';
import { fmt, t, tMaybe } from '@/i18n';
import { checkParam, type ParamDef } from '@/schema/params';
import type { NodeKind, ParamValue } from '@/schema/types';

export function ParamField({
  kind,
  def,
  value,
  running,
  onChange,
}: {
  kind: NodeKind;
  def: ParamDef;
  value: ParamValue | undefined;
  running: boolean;
  onChange: (v: ParamValue) => void;
}) {
  const current = value ?? def.default;
  const [text, setText] = useState(String(current));
  useEffect(() => setText(String(current)), [current]);
  const locked = running && !def.live;
  const label = tMaybe(`params.${kind}.${def.key}.label`);
  const hint = tMaybe(`params.${kind}.${def.key}.hint`);

  let error: string | null = null;
  if (def.type === 'number') {
    const n = Number(text.replace(',', '.'));
    const e = text.trim() === '' ? 'notNumber' : checkParam(def, n);
    if (e) error = t(`props.errors.${e}`, { min: def.min, max: def.max });
  }

  const commit = () => {
    if (def.type !== 'number') return;
    const n = Number(text.replace(',', '.'));
    if (!checkParam(def, n) && n !== current) onChange(n);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Label htmlFor={`p-${def.key}`}>{label}</Label>
        <Tip content={<>{hint}<div className="mt-1 text-muted-foreground">{t('props.default', { value: String(def.default) })}</div></>}>
          <Info className="size-3 cursor-help text-muted-foreground/70" />
        </Tip>
        {locked && (
          <Tip content={t('props.liveLocked')}>
            <Lock className="size-3 text-amber-400" />
          </Tip>
        )}
      </div>
      {def.type === 'enum' ? (
        <Select id={`p-${def.key}`} value={String(current)} disabled={locked} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {tMaybe(`options.${o}`)}
            </option>
          ))}
        </Select>
      ) : def.type === 'text' ? (
        <Input id={`p-${def.key}`} value={text} disabled={locked} onChange={(e) => setText(e.target.value)} onBlur={() => text !== current && onChange(text)} />
      ) : (
        <div className="relative">
          <Input
            id={`p-${def.key}`}
            inputMode="decimal"
            value={text}
            invalid={!!error}
            disabled={locked}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="pr-12"
          />
          {def.unit && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
              {t(`units.${def.unit}`)}
            </span>
          )}
        </div>
      )}
      {error && <div className="text-[11px] text-red-400">{error}</div>}
      {def.type === 'number' && !error && def.max <= 100000 && (
        <div className="sr-only">{`${fmt(def.min)}–${fmt(def.max)}`}</div>
      )}
    </div>
  );
}
