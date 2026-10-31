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

Each phone has its own records. To move devices, open the app menu and download an Excel or JSON backup. Copy that file somewhere separate from the phone, such as a computer or a file-storage account. On the new phone, choose **Restore from backup** and select the file.

## On-device storage and backup

App records use IndexedDB. The app requests persistent browser storage where supported, but the browser may decline; download backups regularly. Profile and section preferences are stored separately in that browser profile. The PIN hashes the entered code for comparison and hides locked sections in the interface; it does not encrypt the records or backup files. Do not save CVVs, card PINs, OTPs, or banking passwords.

## Free hosting

A static HTTPS host is needed for mobile installation, but no managed database is needed. Free hosting terms and limits can change; check them before choosing a provider. No host has been connected or deployed from this repository.

See `docs/implementation-status.md` for current scope and limitations.
