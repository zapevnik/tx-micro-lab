/**
 * Главный экран (раздел 4): верхняя панель, палитра, холст, панель свойств, нижняя панель.
 * Боковые и нижняя панели сворачиваются и меняют размер. Автосохранение — не реже раза в 10 с (ТЗ 7).
 */
import { ReactFlowProvider } from '@xyflow/react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, PanelBottomClose, PanelBottomOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { Canvas } from '@/canvas/Canvas';
import { copySelection, deleteElements, paste } from '@/canvas/editing';
import { ScaleDialogs, ShardWarningDialog } from '@/features/scaling/ScalingUi';
import { projectsRepo } from '@/features/projects/storage';
import { togglePlay } from '@/features/sim/controller';
import { t } from '@/i18n';
import { BottomPanel } from '@/panels/BottomPanel';
import { Palette } from '@/panels/Palette';
import { PropertiesPanel } from '@/panels/PropertiesPanel';
import { project, useProject } from '@/store/project';
import { navigate } from './router';
import { TopBar } from './TopBar';

const AUTOSAVE_MS = 1500;

export function EditorScreen({ projectId }: { projectId: string }) {
  const loadedId = useProject((s) => s.projectId);
  const [missing, setMissing] = useState(false);
  const saved = useAutosave();
  useHotkeys();

  useEffect(() => {
    if (loadedId === projectId) return;
    let cancelled = false;
    projectsRepo.get(projectId).then((rec) => {
      if (cancelled) return;
      if (!rec) setMissing(true);
      else project().load(rec.id, rec.schema);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, loadedId]);

  useEffect(() => {
    if (missing) navigate({ screen: 'start' });
  }, [missing]);

  if (loadedId !== projectId) return null;
  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <TopBar saved={saved} />
        <Layout />
      </div>
      <ScaleDialogs />
      <ShardWarningDialog />
    </ReactFlowProvider>
  );
}

function Layout() {
  const left = useRef<ImperativePanelHandle>(null);
  const right = useRef<ImperativePanelHandle>(null);
  const bottom = useRef<ImperativePanelHandle>(null);
  const [collapsed, setCollapsed] = useState({ left: false, right: false, bottom: false });
  const toggle = (k: keyof typeof collapsed, ref: React.RefObject<ImperativePanelHandle | null>) => {
    if (ref.current?.isCollapsed()) ref.current.expand();
    else ref.current?.collapse();
    setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  };

  return (
    <PanelGroup direction="horizontal" autoSaveId="dtx.layout.h" className="min-h-0 flex-1">
      <Panel ref={left} defaultSize={14} minSize={10} maxSize={22} collapsible collapsedSize={0} onCollapse={() => setCollapsed((c) => ({ ...c, left: true }))} onExpand={() => setCollapsed((c) => ({ ...c, left: false }))} className="bg-card/40">
        <Palette />
      </Panel>
      <Handle />
      <Panel defaultSize={62} minSize={30}>
        <PanelGroup direction="vertical" autoSaveId="dtx.layout.v">
          <Panel defaultSize={70} minSize={25} className="relative">
            <Canvas />
            <div className="absolute left-2 top-2 z-10 flex gap-1">
              <PanelToggle onClick={() => toggle('left', left)} title={t(collapsed.left ? 'bottom.expand' : 'bottom.collapse')}>
                {collapsed.left ? <PanelLeftOpen /> : <PanelLeftClose />}
              </PanelToggle>
            </div>
            <div className="absolute right-2 top-2 z-10 flex gap-1">
              <PanelToggle onClick={() => toggle('bottom', bottom)} title={t(collapsed.bottom ? 'bottom.expand' : 'bottom.collapse')}>
                {collapsed.bottom ? <PanelBottomOpen /> : <PanelBottomClose />}
              </PanelToggle>
              <PanelToggle onClick={() => toggle('right', right)} title={t(collapsed.right ? 'bottom.expand' : 'bottom.collapse')}>
                {collapsed.right ? <PanelRightOpen /> : <PanelRightClose />}
              </PanelToggle>
            </div>
          </Panel>
          <Handle vertical />
          <Panel ref={bottom} defaultSize={30} minSize={12} collapsible collapsedSize={0} onCollapse={() => setCollapsed((c) => ({ ...c, bottom: true }))} onExpand={() => setCollapsed((c) => ({ ...c, bottom: false }))}>
            <BottomPanel />
          </Panel>
        </PanelGroup>
      </Panel>
      <Handle />
      <Panel ref={right} defaultSize={24} minSize={17} maxSize={40} collapsible collapsedSize={0} onCollapse={() => setCollapsed((c) => ({ ...c, right: true }))} onExpand={() => setCollapsed((c) => ({ ...c, right: false }))} className="bg-card/40">
        <PropertiesPanel />
      </Panel>
    </PanelGroup>
  );
}

function Handle({ vertical }: { vertical?: boolean }) {
  return (
    <PanelResizeHandle
      className={
        vertical
          ? 'h-1 bg-border transition-colors data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary/60'
          : 'w-1 bg-border transition-colors data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary/60'
      }
    />
  );
}

function PanelToggle({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground shadow hover:text-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/** Автосохранение проекта в IndexedDB. Возвращает «сохранено ли последнее изменение». */
function useAutosave(): boolean {
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      const { projectId, schema } = project();
      if (!projectId) return;
      projectsRepo.put({ id: projectId, name: schema.meta.name, updatedAt: Date.now(), schema }).then(() => setSaved(true));
    };
    const unsub = useProject.subscribe((s, prev) => {
      if (s.schema === prev.schema || s.projectId !== prev.projectId) return;
      setSaved(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, AUTOSAVE_MS);
    });
    const onUnload = () => save();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsub();
      if (timer) {
        clearTimeout(timer);
        save();
      }
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
  return saved;
}

/** Горячие клавиши: пробел — пуск/пауза, Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / Ctrl+V, Delete. */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      // e.code не зависит от раскладки: Ctrl+Z работает и на русской.
      const code = e.code;
      if (e.code === 'Space' && !mod) {
        e.preventDefault();
        togglePlay();
      } else if (mod && code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        project().undo();
      } else if (mod && ((code === 'KeyZ' && e.shiftKey) || code === 'KeyY')) {
        e.preventDefault();
        project().redo();
      } else if (mod && code === 'KeyC') {
        copySelection();
      } else if (mod && code === 'KeyV') {
        e.preventDefault();
        paste();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = project().selection;
        if (sel.nodes.length || sel.edges.length) {
          e.preventDefault();
          deleteElements(sel.nodes, sel.edges);
        }
      } else if (e.key === 'Escape') {
        project().select({ nodes: [], edges: [] });
        project().setHighlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
