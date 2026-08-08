import { useEffect, useState } from 'react';
import {
  getDesktopDaemonState,
  subscribeDesktopDaemonState,
  type DesktopDaemonState,
} from '../lib/desktop.ts';

export function useDesktopDaemonState(): DesktopDaemonState | null {
  const [state, setState] = useState<DesktopDaemonState | null>(null);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = subscribeDesktopDaemonState((next) => {
      receivedEvent = true;
      if (active) setState(next);
    });
    void getDesktopDaemonState().then((initial) => {
      // Do not let a slower initial IPC response overwrite a newer pushed
      // state that arrived while the request was in flight.
      if (active && initial && !receivedEvent) setState(initial);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
