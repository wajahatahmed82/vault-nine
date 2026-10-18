# Vault Nine on the Apple App Store

Not done yet, and it can't be done from Windows alone. Here is what stands in the way and the cheapest ways through it.

## What Apple requires

| Need | Detail |
|---|---|
| Apple Developer Program | $99 per year |
| A Mac with Xcode | Apple only accepts builds made by Xcode, which only runs on macOS |
| App Review | Apple sometimes rejects apps that look like a website in a wrapper. A full game with offline play and native touch controls usually passes, but it isn't guaranteed. |

## Ways to get Mac access without buying a Mac

1. **GitHub Actions macOS runners.** The same automatic-build approach used for Android, on Apple hardware GitHub hosts. Signing needs your Apple certificates added as secrets, the same way as the Android key. Cheapest once set up, fiddliest to set up the first time.
2. **Rent a cloud Mac** (MacinCloud, MacStadium and similar), roughly $20–30 a month. Remote desktop into a real Mac, build, upload, cancel.
3. **Borrow a Mac for an afternoon.** The first upload is the hardest part; later updates can go through option 1.

## What's already ready for iOS

- The game is a single offline file with touch controls and a landscape layout, which is what an iOS wrapper needs.
- Capacitor (already in the project) supports iOS. On a Mac, `npx cap add ios` creates the Xcode project from the same game files.
- The icon, screenshots and listing text in this folder work for the App Store too. Apple wants extra screenshot sizes, which can be generated the same way.

## Recommendation

Launch on Google Play first. Use its 14-day test to find problems on real phones. Start on iOS once the game has players, so the $99 a year has something to show for it.
