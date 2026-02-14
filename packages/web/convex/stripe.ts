import { components } from './_generated/api';
import StripeSubscriptions from '@convex-dev/stripe';

export const stripeComponent = (components as any).stripe;

export const stripe = new StripeSubscriptions(stripeComponent);
