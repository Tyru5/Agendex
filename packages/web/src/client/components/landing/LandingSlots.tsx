import type { ReactNode } from 'react';
import type { LandingContextValue } from './LandingContext.tsx';

type SlotRenderFn = (ctx: LandingContextValue) => ReactNode;

interface SlotProps {
  children: SlotRenderFn;
}

function NavbarAuth({ children }: SlotProps) {
  return null;
}
NavbarAuth._slotName = 'NavbarAuth' as const;

function HeroCta({ children }: SlotProps) {
  return null;
}
HeroCta._slotName = 'HeroCta' as const;

function PricingCta({ children }: SlotProps) {
  return null;
}
PricingCta._slotName = 'PricingCta' as const;

export { NavbarAuth, HeroCta, PricingCta };
export type { SlotRenderFn };
