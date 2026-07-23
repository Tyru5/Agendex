import { useEffect, useState } from 'react';
import { getDesktopBridgeIdentity, type UpdateState } from '../lib/desktop.ts';

const UPDATE_STATE_EVENT = 'agendex:update:state';

export function useDesktopUpdate() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    const bridge = getDesktopBridgeIdentity();
    if (!bridge) return;
    let mounted = true;

    const handler = (event: CustomEvent<UpdateState>) => {
      setState(event.detail);
    };

    window.addEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    void bridge.getUpdateState().then((currentState) => {
      if (mounted) setState(currentState);
    });
    return () => {
      mounted = false;
      window.removeEventListener(UPDATE_STATE_EVENT, handler as EventListener);
    };
  }, []);

  const checkForUpdates = () => {
    void getDesktopBridgeIdentity()?.checkForUpdates();
  };

  const installUpdate = () => {
    void getDesktopBridgeIdentity()?.installUpdate();
  };

  return { state, checkForUpdates, installUpdate };
}
