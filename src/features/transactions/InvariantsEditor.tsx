/** Инварианты данных (ТЗ 5.6): выбор из готового набора с указанием таблиц и полей. */
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { t } from '@/i18n';
import { INVARIANT_DEFS } from '@/schema/dictionary';
import { newId } from '@/schema/ids';
import { INVARIANT_TYPES, type Invariant, type InvariantType } from '@/schema/types';
import { project, useProject } from '@/store/project';

export function InvariantsEditor() {
  const invariants = useProject((s) => s.schema.invariants);
  const set = (list: Invariant[]) => project().apply((s) => ({ ...s, invariants: list }));
  const upd = (id: string, patch: Partial<Invariant>) => set(invariants.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const unused = INVARIANT_DEFS.find((d) => !invariants.some((i) => i.type === d.type)) ?? INVARIANT_DEFS[0];

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">{t('invariants.hint')}</div>
      {invariants.length === 0 && <div className="text-xs text-muted-foreground">{t('invariants.empty')}</div>}
      {invariants.map((inv) => (
        <div key={inv.id} className="space-y-1 rounded-md border border-border bg-background/40 p-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-400" />
            <Select
              className="h-7 flex-1 text-xs"
              value={inv.type}
              onChange={(e) => {
                const def = INVARIANT_DEFS.find((d) => d.type === e.target.value)!;
                upd(inv.id, { type: def.type as InvariantType, table: def.table, field: def.field });
              }}
            >
              {INVARIANT_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`invariants.types.${tp}`)}
                </option>
              ))}
            </Select>
            <button className="cursor-pointer rounded p-1 text-muted-foreground hover:text-red-400" onClick={() => set(invariants.filter((i) => i.id !== inv.id))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pl-5">
            <Input className="h-6 font-mono text-[11px]" value={inv.table} onChange={(e) => upd(inv.id, { table: e.target.value })} />
            <Input className="h-6 font-mono text-[11px]" value={inv.field} onChange={(e) => upd(inv.id, { field: e.target.value })} />
          </div>
        </div>
      ))}
      <Button size="xs" variant="secondary" onClick={() => set([...invariants, { id: newId('inv'), ...unused }])}>
        <Plus /> {t('invariants.add')}
      </Button>
    </div>
  );
}
