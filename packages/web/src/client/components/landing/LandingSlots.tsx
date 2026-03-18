import type { ReactNode } from 'react';

type SlotRenderFn = () => ReactNode;

interface SlotProps {
  children: SlotRenderFn;
}

export interface SlotComponent {
  (props: SlotProps): null;
  _slotName: string;
}

const NavbarAuth: SlotComponent = function NavbarAuth() {
  return null;
};
NavbarAuth._slotName = 'NavbarAuth';

const HeroCta: SlotComponent = function HeroCta() {
  return null;
};
HeroCta._slotName = 'HeroCta';

const PricingCta: SlotComponent = function PricingCta() {
  return null;
};
PricingCta._slotName = 'PricingCta';

export { NavbarAuth, HeroCta, PricingCta };
export type { SlotRenderFn };
