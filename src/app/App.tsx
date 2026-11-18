import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui';
import { CompareScreen } from '@/features/compare/CompareScreen';
import { initSimController } from '@/features/sim/controller';
import { EditorScreen } from './EditorScreen';
import { GlobalDialogs } from './GlobalDialogs';
import { useRoute } from './router';
import { StartScreen } from './StartScreen';

export function App() {
  const route = useRoute();
  useEffect(() => initSimController(), []);
  return (
    <TooltipProvider>
      {route.screen === 'start' && <StartScreen />}
      {route.screen === 'editor' && <EditorScreen key={route.projectId} projectId={route.projectId} />}
      {route.screen === 'compare' && <CompareScreen projectId={route.projectId} />}
      <GlobalDialogs />
    </TooltipProvider>
  );
}
