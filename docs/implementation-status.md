# Implementation status

## Implemented prototype flows

- Home view with quick actions for income, expenses, tasks, and events; unpaid monthly payments; and separate task and event panels. Financial totals stay in their respective sections.
- Optional PIN protection is available independently for Balance Sheet and Personal Vault; the PIN verifier is salted and hashed.
- Combined money-position page with separate “Owned / owed to me” and “What I owe” lists and totals, covering property, investments, money lent, loans, and debts.
- Month selector and separate Add Income/Add Expense actions in Cash Flow; new entries default to one-time and use today’s date, and the Cash Flow totals follow the selected month.
- Clickable monthly income and expense cards filter the selected month's transaction list; categories are user-entered (examples include salary, interest, rent, groceries, utilities, and medical).
- Income and expense forms support one-time or monthly entries. A monthly entry can repeat for a chosen number of months or continue until paused/edited; fixed expenses also have a configurable due day that defaults to the 10th.
- Edit and delete actions are available for planner items, transactions, fixed templates, assets, liabilities, payments, vault entries, and Other Info records. Other Info entries support free-text details and view/copy.
- Balance Sheet and Personal Vault PIN requirements can be enabled or disabled independently; other sections have no privacy controls.
- Cash Flow has Month and Year selectors. Years follow the current year, allow adding the next year, and only show past years with cash-flow data; the current year and years with records cannot be deleted.
- Planner tasks and events are displayed in separate panels and support due dates, remaining-day labels, and red overdue status. Home lists them separately too.
- Payments are generated from monthly expenses in Cash Flow. One-time spending such as a purchase stays out of Payments. Monthly income and expenses are included in their month’s totals and balance even while a bill is pending; bills have a month-specific paid status in Payments.
- Personal Vault entries open in a detail pop-up with a copy-information action.
- Records are stored in device-local IndexedDB; legacy browser records migrate on first launch. Browser persistent-storage retention is requested when supported.
- A PWA manifest, app icon, and service worker provide installable app-shell caching for offline launch after the app is first loaded online.
- JSON and Excel backups include all collections, including Other Info. Older backups without Other Info remain restorable.
- INR formatting and monthly cash-flow totals kept separate from net worth.
- Excel and JSON export and validated Excel/JSON restore.

## Mobile and production boundary

- This is a local-first app with no cloud database or cross-device sync. Mobile installation requires publishing the static build to an HTTPS host. The host serves app files; records stay in each device's IndexedDB.
- Records and exported backups are readable data; PIN protection gates the UI but does not encrypt records. Store the backup somewhere separate from the phone to recover after loss or replacement. Avoid CVVs, card PINs, OTPs, and banking passwords.
- IndexedDB may be evicted by the browser if persistent storage is not granted. Regular independent backups are required for recovery.
- Responsive desktop/mobile navigation.

## Not implemented; required before production

- Account registration, Google sign-in, cloud synchronization, account recovery, session revocation, or a Go API.
- PostgreSQL schema/migrations, per-account authorization, encrypted envelope sync, incremental cursors, tombstones, idempotency, or conflict resolution.
- Web Crypto data encryption, recovery-key derivation/wrapping, key rotation, encrypted export, or encrypted restore.
- PIN attempt rate limiting, inactivity auto-lock, cross-device lock, or memory clearing.
- Editing recurring amounts with effective-month history, repayments, obligation-to-transaction linking, custom financial categories, and validated event reminders.

## Security choices to resolve

1. Recovery phrase format and KDF parameters; never use the short PIN as the only key secret.
2. Account key versus per-record keys and the intended deletion guarantee for provider backups.
3. Whether record type and timestamps remain visible as server metadata.
4. Device registry, acknowledgement policy, tombstone retention, and stale-device behavior.
5. Session design and account recovery that works on a clean replacement device.
6. Self-hosted deployment, backup retention, restore process, HTTPS, and a zero-cost operating plan.

The project can be run and built locally without paying for software or a database. Mobile app distribution needs an HTTPS static host; no provider is selected here, and a free tier's limits and terms can change. Device-to-device synchronization is not implemented; use the downloaded backup to move records.
