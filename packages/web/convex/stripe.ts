import StripeSubscriptions from '@convex-dev/stripe';
import { components } from './_generated/api';

export const stripeComponent = (components as any).stripe;

export const stripe = new StripeSubscriptions(stripeComponent);
