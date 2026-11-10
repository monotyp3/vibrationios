# Haptic Link

Two iPhones, one button. Whatever one person taps, holds, or drums out, the other phone vibrates with the same timing.

## What's in here

```
haptic-link/
  server/                    Node.js Socket.io relay (pairs 2 phones per room)
  app/                       Capacitor iOS app
    www/                     index.html, style.css, app.js (the UI and logic)
    plugins/haptic-touch/    Small native Swift plugin for true press-and-hold haptics
    scripts/build-ipa.sh     Builds an unsigned .ipa for Sideloadly / AltStore
  .github/workflows/         Free cloud build on a GitHub macOS runner
```

### Why there is a small native plugin

`@capacitor/haptics` only has `vibrate(duration)`, so it has to know how long to buzz before the buzz starts. When you mirror a live finger, you don't know that until the finger lifts. The `haptic-touch` plugin adds `start()` and `stop()` on top of Apple's Core Haptics engine, which it keeps running so the buzz starts almost instantly. `@capacitor/haptics` is still installed, and the app falls back to it automatically if the custom plugin ever fails to load.

### How the timing stays exact

Every press sends a down event and every release sends an up event, each stamped with the sender's clock. The receiving phone plays them back on a 40 ms buffer, so the spacing between events matches the sender even if the network delay shifts a little from one packet to the next. On a local test, 3 taps of 80 ms with 150 ms gaps came out on the other side as 77/81/80 ms buzzes with 151/153 ms gaps.

---

## Step 1: Run the server

Both phones need to reach the same server.

**Option A: Free cloud server (recommended, works anywhere)**

1. Put this folder in a GitHub repo (you need that for Step 2 anyway).
2. Go to render.com, sign up, and click New > Web Service.
3. Connect the repo and set:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance type: Free
4. Deploy. You get a URL like `https://haptic-link-xxxx.onrender.com`. That's your Server URL in the app.

Note: Render's free tier goes to sleep after about 15 minutes with no traffic. The first connection after that can take up to a minute while it wakes up. The app keeps retrying on its own.

**Option B: Your own computer (same Wi-Fi only)**

```
cd server
npm install
npm start
```

Find your computer's local IP (for example 192.168.1.20). The Server URL is then `http://192.168.1.20:3000`. The first time you connect, iOS will ask for Local Network permission. Tap Allow.

---

## Step 2: Build the .ipa

You need macOS to compile an iOS app. If you don't have a Mac, use Option A.

**Option A: GitHub Actions (free, no Mac needed)**

1. Create a GitHub repo and upload everything in this folder. The `.github` folder must be at the top level of the repo.
2. Open the repo's Actions tab, pick "Build iOS .ipa", and click Run workflow.
3. Wait about 5 to 15 minutes. Open the finished run and download HapticLink-ipa under Artifacts.
4. Unzip it to get `HapticLink.ipa`.

Cost: free and unlimited for public repos. For private repos, GitHub's 2,000 free minutes per month count macOS time at 10x, which still covers roughly 15 to 20 builds a month.

**Option B: Your own Mac**

1. Install Xcode from the App Store, open it once, and accept the license.
2. Install Node.js 22 or newer.
3. Run:

```
cd app
npm run build:ipa
```

The file ends up at `app/dist/HapticLink.ipa`.

With a Mac you can also skip the .ipa: run `npx cap open ios`, pick your Apple ID under Signing & Capabilities, plug in your phone, and press Run.

---

## Step 3: Sideload it onto each iPhone

**Sideloadly (Windows or Mac)**

1. On Windows, install iTunes and iCloud from Apple's website (not the Microsoft Store versions).
2. Plug in the iPhone and tap Trust on the phone.
3. Open Sideloadly, drag in `HapticLink.ipa`, enter your Apple ID, and click Start.
4. On the iPhone, go to Settings > General > VPN & Device Management and trust your Apple ID.
5. Turn on Developer Mode: Settings > Privacy & Security > Developer Mode. The phone restarts and asks you to confirm.

Repeat for the second phone. Each person can use their own Apple ID.

**AltStore** works too. Install AltServer on your computer, install AltStore on the phone, then open the .ipa from AltStore's My Apps tab. AltStore can refresh the app automatically when the phone and computer are on the same Wi-Fi.

**Free Apple ID limits**
- The app stops opening after 7 days. Re-sideload it, or let AltStore refresh it.
- A maximum of 3 sideloaded apps per device at a time.
- A paid Apple Developer account ($99/year) extends this to 1 year and allows TestFlight.

---

## Step 4: Use it

1. Open Haptic Link on both phones.
2. Enter the same Server URL and the same room code (for example SHANE1) on both, then tap Join room.
3. Once both phones show "Partner online", tap or hold the big button.

A green ring on your screen shows when your partner is pressing. The number in the top right is the round trip time to the server.

---

## Things to know

- **Both apps have to be open and on screen.** iOS shuts down network connections for apps in the background, and only Apple's push notification system can wake a closed app. The app keeps the screen from auto-locking while you're in a room. Swiping away from the app stops it.
- **Feeling nothing?** Check Settings > Accessibility > Touch > Vibration. If that's off, iOS blocks every vibration, including this app's.
- **Older iPhones:** the iPhone 8 and newer support Core Haptics. Older models fall back to the standard system buzz.
- **Tuning:** the settings at the top of `app/www/app.js` let you adjust the jitter buffer, minimum buzz length, and safety timeout. To set a default server URL so nobody has to type it, fill in `DEFAULT_SERVER` there. Run `npx cap sync ios` (or just rebuild) after any change.
- **Testing without phones:** run the server, then serve `app/www` with any static server (for example `npx serve app/www`) and open it in two browser tabs. The button and ring work, and an Android phone's browser will even vibrate.
