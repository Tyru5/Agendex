import type { Plan } from './api.ts';

export type PlanStatePlan = Pick<Plan, 'id' | 'updatedAt'>;

export type PlanState = {
  isUnseen: (planId: string, updatedAt: string) => boolean;
  markSeen: (planId: string, updatedAt: string) => void;
  markUnseen: (planId: string) => void;
  markAllSeen: (plans: PlanStatePlan[]) => void;
  isPinned: (planId: string) => boolean;
  setPinned: (planId: string, pinned: boolean) => void;
};
