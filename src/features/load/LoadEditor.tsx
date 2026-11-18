/** Нагрузка клиента (ТЗ 5.7): целевой RPS, профиль, смесь эндпоинтов (сумма = 100%). */
import { Button, Input, Label, Select, Slider } from '@/components/ui';
import { setClientRps } from '@/features/sim/controller';
import { fmt, t } from '@/i18n';
import { cn } from '@/lib/utils';
import { nodeById, reachableFromClient } from '@/schema/analysis';
import { evenMix, updateWorkload } from '@/schema/ops';
import type { LoadProfile } from '@/schema/types';
import { project, useProject } from '@/store/project';

const PROFILES: LoadProfile[] = ['constant', 'ramp', 'spike', 'sine'];

export function LoadEditor({ clientId }: { clientId: string }) {
  const schema = useProject((s) => s.schema);
  const w = schema.workload.find((x) => x.clientId === clientId) ?? { clientId, profile: 'constant' as const, rps: 0, mix: [] };
  const reachable = schema.endpoints.filter((ep) => ep.trigger.type === 'http' && reachableFromClient(schema, clientId, ep.serviceId));
  const sum = w.mix.reduce((a, m) => a + m.pct, 0);
  const upd = (patch: Parameters<typeof updateWorkload>[2]) => project().apply((s) => updateWorkload(s, clientId, patch));
  const pctOf = (id: string) => w.mix.find((m) => m.endpointId === id)?.pct ?? 0;

  const setPct = (id: string, pct: number) => {
    const mix = w.mix.filter((m) => m.endpointId !== id);
    if (pct > 0) mix.push({ endpointId: id, pct });
    mix.sort((a, b) => reachable.findIndex((e) => e.id === a.endpointId) - reachable.findIndex((e) => e.id === b.endpointId));
    upd({ mix });
  };

  return (
    <div className="space-y-4 p-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t('load.rps')}</Label>
          <Input
            className="h-7 w-24 text-right font-mono text-xs"
            inputMode="numeric"
            value={w.rps}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 1e6) setClientRps(clientId, v, true);
            }}
            data-testid="client-rps"
          />
        </div>
        <Slider
          min={0}
          max={Math.max(3000, w.rps)}
          step={10}
          value={w.rps}
          onChange={(e) => setClientRps(clientId, Number(e.target.value), false)}
          onPointerUp={(e) => setClientRps(clientId, Number((e.target as HTMLInputElement).value), true)}
        />
        <div className="text-[11px] leading-snug text-muted-foreground">{t('load.rpsHint')}</div>
      </div>

      <div className="space-y-1">
        <Label>{t('load.profile')}</Label>
        <Select value={w.profile} onChange={(e) => upd({ profile: e.target.value as LoadProfile })}>
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {t(`load.profiles.${p}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t('load.mix')}</Label>
          {reachable.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => upd({ mix: evenMix(reachable.map((e) => e.id)) })}>
              {t('load.even')}
            </Button>
          )}
        </div>
        {reachable.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">{t('load.noEndpoints')}</div>
        ) : (
          <>
            {reachable.map((ep) => (
              <div key={ep.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{ep.name}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{nodeById(schema, ep.serviceId)?.name}</div>
                </div>
                <Input
                  className="h-7 w-16 text-right font-mono text-xs"
                  inputMode="numeric"
                  value={pctOf(ep.id)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 100) setPct(ep.id, v);
                  }}
                />
                <span className="text-[11px] text-muted-foreground">%</span>
              </div>
            ))}
            <div className={cn('text-[11px]', Math.abs(sum - 100) > 0.01 ? 'text-red-400' : 'text-muted-foreground')}>
              {t('load.mixSum', { sum: fmt(sum) })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
