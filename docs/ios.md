# The iPhone app on TestFlight

Every push to `main` builds the iPhone app, signs it and uploads it to TestFlight, next to the desktop release. Installed copies update through the TestFlight app. Until the four secrets below exist, that step is skipped and everything else still releases.

The app is the shell in `packages/ios-shell`: it finds Tessel on your network and opens the phone page from your computer, so most phone changes reach it straight from the desktop app; TestFlight builds bring the native parts (discovery, haptics, keeping the screen on) up to date.

## One-time setup

You need a paid Apple Developer Program membership ($99 a year).

1. **Team ID.** developer.apple.com › Account › Membership details › Team ID (10 characters).
2. **The app record.** appstoreconnect.apple.com › Apps › **+** › New App: platform iOS, name Tessel (or anything free), bundle ID **com.wrlliam.tessel** (if it isn't listed, add it first at developer.apple.com › Identifiers › **+** › App IDs), SKU `tessel`.
3. **An API key.** App Store Connect › Users and Access › Integrations › App Store Connect API › **+**. Role: **Admin** (needed to sign in the cloud). Download the `.p8` file (only once) and note the **Key ID** and the **Issuer ID** at the top of the page.
4. **GitHub secrets.** github.com/wrlliam/tessel › Settings › Secrets and variables › Actions › New repository secret:
   - `APPLE_TEAM_ID`: the Team ID
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8`: the whole contents of the `.p8` file (or the file base64-encoded)
5. **Testers.** App Store Connect › your app › TestFlight › Internal Testing › **+** to make a group, add yourself, and turn on automatic distribution. Install TestFlight on your iPhone and accept the invite.

The next push to `main` uploads a build. Apple processes it for a few minutes, then it appears in TestFlight; with automatic distribution, every later build reaches your phone by itself.

## Numbers

The app's version is the desktop release's (e.g. 0.1.12) and its build number is the release workflow's run number, so every upload is newer than the last.

## Building by hand

```sh
pnpm --filter @tessel/ios-shell open   # builds, syncs and opens Xcode
```
