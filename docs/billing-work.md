# Creator billing implementation

The owner selected SUBCULT.TV sandbox, `acct_1ULZACIOX2zV9jxz`.
Proposed launch price: $12 USD monthly.
Free editing and local exports remain available. Creator includes 120 cloud output
minutes per calendar month, up to 4K, 15 minutes per job and seven-day downloads.

- [x] Create sandbox product, monthly price and cancellation portal configuration.
- [x] Register the webhook destination, disabled until the application is ready.
- [x] Add authenticated Checkout and portal routes, subscription reconciliation and signed webhooks.
- [x] Add billing UI and subscription-aware account deletion.
- [x] Verify entitlement boundaries, concurrent checkout, webhook replay and subscription changes.
- [x] Deploy and exercise sandbox payment, renewal, failed payment and cancellation.

Live payments and tax collection are not enabled. Sandbox deployment requires a
restricted API key and the endpoint signing secret in the deployment environment.

## Sandbox configuration

- Product: `prod_VMIMN4KfmtBDwK`
- Monthly price: `price_1ULZlWIOX2zV9jxzoSP11UiE`, USD 1200 cents
- Portal: `bpc_1ULZlXIOX2zV9jxzCH20bbSM`, cancellation at period end
- Webhook: `we_1ULZlYIOX2zV9jxzDSEMbd1S`
- Destination: `https://undertow.subcult.tv/v1/billing/webhook`
- Snapshot event version: `2026-08-26.dahlia`
- Events: Checkout completion and asynchronous success/failure, subscription
  creation/update/deletion/pause/resume, invoice paid and payment failed

The signing secret is stored outside the repository. The supplied test key was
verified against the selected sandbox and its Creator price. Both builds and all
29 tests passed, including real PostgreSQL and a simulated Stripe HTTP service.
Public hosted Checkout and customer portal completed successfully. Stripe test clocks verified paid renewal, failed renewal, recovery and end-of-period cancellation through real HTTPS webhook delivery. The paid account rendered and downloaded a two-second MP4. Standard Checkout is selected explicitly because this sandbox defaults to Managed Payments. Scheduled cancellation dates from the flexible billing portal are honored. The
earlier subculture-collective sandbox objects are retained, with webhook delivery
disabled. No live-mode settings were changed.
