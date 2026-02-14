# Stripe Integration Setup Guide

## What's Been Implemented

### Backend
- ✅ Installed `@convex-dev/stripe` and `stripe` packages
- ✅ Registered Stripe component in `convex/convex.config.ts`
- ✅ Extended schema with `subscriptions` and `workspaceMembers` tables
- ✅ Created `convex/subscriptions.ts` with:
  - `getMySubscriptionQuery` - fetch user subscription
  - `createCheckoutSession` - initiate Stripe checkout
  - `createPortalSession` - billing portal URL
  - `hasActiveSubscription` helper
- ✅ Created `convex/stripe.ts` helper module
- ✅ Updated `convex/http.ts` to register Stripe webhook routes
- ✅ Gated `publishPlan` mutation behind subscription check
- ✅ Gated CLI `sync` action behind subscription check

### Frontend
- ✅ Created `useSubscription` hook
- ✅ Created `PricingModal` component
- ✅ Created `SubscriptionBadge` component
- ✅ Created `PaywallGuard` component
- ✅ Integrated SubscriptionBadge into App.tsx topbar
- ✅ Updated LandingPage.tsx "Get Started" button to show pricing modal

## Next Steps

### 1. Environment Variables

Add these to Convex deployment environment (deployment settings or `.env.local` for local testing):

```
STRIPE_SECRET_KEY=sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_MONTHLY_PRICE_ID=price_...
STRIPE_YEARLY_PRICE_ID=price_...
VITE_CONVEX_URL=https://your-deployment.convex.site
```

### 2. Stripe Configuration

1. **Create Products in Stripe Dashboard**:
   - Product 1: "Cloud Pro - Monthly"
     - Price: $7/month (recurring, monthly)
     - Price ID: `price_...` (copy to STRIPE_MONTHLY_PRICE_ID)

   - Product 2: "Cloud Pro - Yearly"
     - Price: $69/year (recurring, yearly)
     - Price ID: `price_...` (copy to STRIPE_YEARLY_PRICE_ID)

2. **Create Webhook Endpoint**:
   - URL: `https://your-deployment.convex.site/stripe/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Copy webhook signing secret to STRIPE_WEBHOOK_SECRET

3. **Configure Customer Portal**:
   - Enable subscription management
   - Enable subscription cancellation
   - Enable plan switching (monthly ↔ yearly)
   - Show invoice history

### 3. Webhook Handler

Create `convex/webhooks/stripe.ts` to handle Stripe events and update subscription status in DB. Example events to handle:

```typescript
// checkout.session.completed → create subscription record
// customer.subscription.updated → update subscription status
// customer.subscription.deleted → update status to 'canceled'
// invoice.payment_failed → update status to 'past_due'
```

This sync ensures DB subscription status matches Stripe source of truth.

### 4. Type Generation

After deploying these changes to Convex, regenerate types:

```bash
cd packages/web
bunx convex codegen
```

This will generate proper types for the new subscriptions mutations/queries.

### 5. Testing

**Local testing (test cards)**:
- Use Stripe test mode: `sk_test_...`
- Test card: `4242 4242 4242 4242` (any expiry/CVC)
- Declined card: `4000 0000 0000 0002`

**Test flows**:
1. Unauthenticated user sees "Upgrade to Pro" button on landing
2. Click triggers PricingModal
3. Select monthly/yearly, hit "Get Started"
4. Redirected to Stripe Checkout
5. After payment → webhook updates subscription in DB
6. User can now `publishPlan` and sync via CLI
7. Click "Pro" badge → "Manage Billing" opens portal
8. Can upgrade/downgrade/cancel in portal
9. Changes sync back via webhooks

### 6. Error Handling

Update error messages in frontend to handle:
- `"Cloud Pro subscription required"` → show paywall
- Stripe checkout errors → show toast/modal
- Webhook failures → retry logic or monitoring

### 7. CLI Integration

Update CLI to check for subscription before allowing sync:
- On 403 response from sync endpoint → show upgrade prompt
- Link to dashboard or landing page

## Current Configuration

- **No trial period** - immediate charge on signup
- **Single subscription per user** - covers all workspaces
- **No workspace collaboration gates** yet (Phase 2)

## Files Created

- `convex/stripe.ts` - Stripe component helper
- `convex/subscriptions.ts` - subscription queries/mutations
- `packages/web/src/client/hooks/useSubscription.ts` - React hook
- `packages/web/src/client/components/PricingModal.tsx` - pricing UI
- `packages/web/src/client/components/SubscriptionBadge.tsx` - status badge
- `packages/web/src/client/components/PaywallGuard.tsx` - access control wrapper

## Files Modified

- `convex/convex.config.ts` - register Stripe component
- `convex/schema.ts` - add subscriptions + workspaceMembers tables
- `convex/http.ts` - register webhook routes
- `convex/plans.ts` - add subscription check to publishPlan
- `convex/cli.ts` - add subscription check to sync
- `packages/web/src/client/App.tsx` - add SubscriptionBadge to topbar
- `packages/web/src/client/components/LandingPage.tsx` - update Get Started CTA

## Known Issues

- TypeScript errors about missing Stripe types will resolve after Convex codegen
- Webhook handler not yet implemented (Priority: HIGH for Phase 2)
- No email notifications on subscription changes yet
