import { useEffect, useState } from 'react';
import { isDesktop, type UpdateState } from '../lib/desktop.ts';

const UPDATE_STATE_EVENT = 'agendex:update:state';

export function useDesktopUpdate() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    if (!isDesktop()) return;

    const handler = (event: CustomEvent<UpdateState>) => {
      setState(event.detail);
    };

    window.addEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    };
  }, []);

  const checkForUpdates = () => {
    if (isDesktop()) {
      void window.agendexDesktop.checkForUpdates();
    }
  };

  const installUpdate = () => {
    if (isDesktop()) {
      void window.agendexDesktop.installUpdate();
    }
  };

  return { state, checkForUpdates, installUpdate };
}
