import StripeSubscriptions from '@convex-dev/stripe';
import { components } from './_generated/api';

export const stripeComponent = components.stripe;

export const stripe = new StripeSubscriptions(stripeComponent);
