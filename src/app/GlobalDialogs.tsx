/** Общие диалоги и уведомления: ввод значения, подтверждение, тосты. */
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Dialog, Input, Label } from '@/components/ui';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { ui, useUi } from '@/store/ui';

export function GlobalDialogs() {
  const prompt = useUi((s) => s.prompt);
  const confirm = useUi((s) => s.confirm);
  const toasts = useUi((s) => s.toasts);
  const [value, setValue] = useState('');
  useEffect(() => setValue(prompt?.value ?? ''), [prompt]);

  const submit = () => {
    prompt?.onSubmit(value);
    ui().ask(null);
  };

  return (
    <>
      {prompt && (
        <Dialog
          open
          onOpenChange={(o) => !o && ui().ask(null)}
          title={prompt.title}
          footer={
            <>
              <Button variant="ghost" onClick={() => ui().ask(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={submit} data-testid="prompt-ok">
                {t('common.ok')}
              </Button>
            </>
          }
        >
          <div className="space-y-1">
            <Label>{prompt.label}</Label>
            <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} data-testid="prompt-input" />
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          open
          onOpenChange={(o) => !o && ui().askConfirm(null)}
          title={t('common.confirm')}
          description={confirm.text}
          footer={
            <>
              <Button variant="ghost" onClick={() => ui().askConfirm(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  confirm.onConfirm();
                  ui().askConfirm(null);
                }}
                data-testid="confirm-ok"
              >
                {t('common.yes')}
              </Button>
            </>
          }
        />
      )}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((toast) => {
          const Icon = toast.tone === 'error' ? AlertCircle : toast.tone === 'success' ? CheckCircle2 : toast.tone === 'warn' ? AlertTriangle : Info;
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'hint-in pointer-events-auto flex max-w-lg items-center gap-2 rounded-md border bg-popover px-3 py-2 text-[13px] shadow-xl',
                toast.tone === 'error' && 'border-red-500/60',
                toast.tone === 'success' && 'border-emerald-500/60',
                toast.tone === 'warn' && 'border-amber-500/60',
              )}
              onClick={() => ui().dropToast(toast.id)}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  toast.tone === 'error' ? 'text-red-400' : toast.tone === 'success' ? 'text-emerald-400' : toast.tone === 'warn' ? 'text-amber-400' : 'text-sky-400',
                )}
              />
              {toast.text}
            </div>
          );
        })}
      </div>
    </>
  );
}
