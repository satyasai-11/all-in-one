# All In One

A responsive personal organizer built with React, TypeScript, and Vite. Records are saved on the current device in IndexedDB. The app has no cloud database or account sync. Personal data can be downloaded as readable JSON or Excel and restored on another device.

## Run locally

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run dev
```

Create a static production build with `npm run build`. This project uses free/open-source frontend libraries and requires no paid service or API key.

## Use on a phone

Installable offline-app support is included. Publish the contents of `dist` to a static HTTPS host, then open its URL on the phone. No database or backend hosting is needed; the hosted site serves the app code, while records stay in that phone's browser storage.

- Android: open the HTTPS site in Chrome and choose **Install app** or **Add to Home screen** from the browser menu.
- iPhone: open the HTTPS site in Safari, tap **Share**, then **Add to Home Screen**.

The app is hosted at [all-in-one-vibe-code.vercel.app](https://all-in-one-vibe-code.vercel.app). Each phone has its own records. Before uninstalling the app or changing phones, open the sidebar and download an Excel or JSON backup. Save a copy somewhere separate from the phone, such as a computer or a file-storage account.

To restore, install/open the app, choose **Restore from backup** at the bottom of the sidebar, and select the `.xlsx` or `.json` file. Confirm the prompt to replace the data currently on that device. Restore replaces the device's current records; it does not merge them. The backup includes the records and section lock preferences. PIN credentials are device-specific, so set a new PIN after restoring if a section is locked.

The hosted app can be updated without uninstalling it. When the phone is online, close and reopen the installed app or refresh its browser tab to load the latest version. Updating the app does not intentionally clear the local records. Uninstalling can remove browser/app storage depending on the phone and browser, so keep a backup before uninstalling.

## On-device storage and backup

App records use IndexedDB. The app requests persistent browser storage where supported, but the browser may decline; download backups regularly. Profile and section preferences are stored separately in that browser profile. The PIN hashes the entered code for comparison and hides locked sections in the interface; it does not encrypt the records or backup files. Do not save CVVs, card PINs, OTPs, or banking passwords.

## Hosting and records

Vercel hosts the static app files. Records stay in IndexedDB on each device; they are not uploaded or synchronized to Vercel. The Vercel project is updated by building the app and deploying the generated `dist` files.

See `docs/implementation-status.md` for current scope and limitations.
