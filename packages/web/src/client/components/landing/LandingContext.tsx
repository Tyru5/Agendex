import { createContext, useContext } from 'react';

export interface LandingState {
  token: string;
  showLogin: boolean;
  yearly: boolean;
  openFaq: number | null;
  activeTab: 'local' | 'cloud';
  bentoInView: boolean;
  signingIn: boolean;
}

export type LandingAction =
  | { type: 'SET_TOKEN'; value: string }
  | { type: 'SET_SHOW_LOGIN'; value: boolean }
  | { type: 'SET_YEARLY'; value: boolean }
  | { type: 'SET_OPEN_FAQ'; value: number | null }
  | { type: 'SET_ACTIVE_TAB'; value: 'local' | 'cloud' }
  | { type: 'SET_BENTO_IN_VIEW' }
  | { type: 'START_SIGNING_IN' }
  | { type: 'STOP_SIGNING_IN' };

export function landingReducer(state: LandingState, action: LandingAction): LandingState {
  switch (action.type) {
    case 'SET_TOKEN':
      return { ...state, token: action.value };
    case 'SET_SHOW_LOGIN':
      return { ...state, showLogin: action.value };
    case 'SET_YEARLY':
      return { ...state, yearly: action.value };
    case 'SET_OPEN_FAQ':
      return { ...state, openFaq: action.value };
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.value };
    case 'SET_BENTO_IN_VIEW':
      return { ...state, bentoInView: true };
    case 'START_SIGNING_IN':
      return { ...state, signingIn: true };
    case 'STOP_SIGNING_IN':
      return { ...state, signingIn: false };
    default:
      return state;
  }
}

export const LANDING_INITIAL: LandingState = {
  token: '',
  showLogin: false,
  yearly: false,
  openFaq: null,
  activeTab: 'local',
  bentoInView: false,
  signingIn: false,
};

export interface LandingContextValue {
  signingIn: boolean;
  activeTab: 'local' | 'cloud';
  showLogin: () => void;
  startSigningIn: () => void;
  stopSigningIn: () => void;
}

export const LandingContext = createContext<LandingContextValue | null>(null);

export function useLandingContext(): LandingContextValue {
  const ctx = useContext(LandingContext);
  if (!ctx) throw new Error('useLandingContext must be used inside <LandingPage>');
  return ctx;
}
