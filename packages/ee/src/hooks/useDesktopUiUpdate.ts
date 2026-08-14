import { useEffect, useState } from 'react';
import {
  DESKTOP_UI_UPDATE_STATE_EVENT,
  getDesktopBridgeIdentity,
  type UiUpdateState,
} from '../lib/desktop.ts';

/**
 * Tracks the desktop UI-bundle updater, which ships interface changes without a
 * new Electron build. Mirrors useDesktopUpdate; reports 'unsupported' on shells
 * that predate the feature so callers can hide the controls rather than leave
 * them inert.
 */
export function useDesktopUiUpdate() {
  const [state, setState] = useState<UiUpdateState>({ status: 'idle' });
  const [revision, setRevision] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridgeIdentity();
    if (!bridge?.getUiUpdateState) {
      setState({ status: 'unsupported' });
      return;
    }
    let mounted = true;

    const handler = (event: CustomEvent<UiUpdateState>) => {
      setState(event.detail);
    };

    window.addEventListener(DESKTOP_UI_UPDATE_STATE_EVENT, handler as EventListener);
    void bridge.getUiUpdateState().then((currentState) => {
      if (mounted) setState(currentState);
    });
    void bridge.getUiRevision?.().then((current) => {
      if (mounted) setRevision(current);
    });
    void bridge.getUiVersion?.().then((current) => {
      if (mounted) setVersion(current);
    });

    return () => {
      mounted = false;
      window.removeEventListener(DESKTOP_UI_UPDATE_STATE_EVENT, handler as EventListener);
    };
  }, []);

  const checkForUiUpdates = () => {
    void getDesktopBridgeIdentity()?.checkForUiUpdates?.();
  };

  const applyUiUpdate = () => {
    void getDesktopBridgeIdentity()?.applyUiUpdate?.();
  };

  return { state, revision, version, checkForUiUpdates, applyUiUpdate };
}
