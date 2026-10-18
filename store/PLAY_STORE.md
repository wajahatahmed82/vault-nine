# Getting Vault Nine onto Google Play

Everything that can be done in code is done. These steps need **you**: an account, a payment, an identity check, your own signing key, and real testers. Store rules change, so check each one in Play Console as you go — this was written in October 2026.

---

## Step 1 — Try it on your phone (free, today)

1. On your Android phone, open https://github.com/wajahatahmed82/vault-nine/releases/tag/android-latest
2. Download `vault-nine-test.apk`.
3. Android will ask to allow installs from your browser. Allow it for this install.
4. Open **Vault Nine** from your home screen.

This test build is rebuilt automatically every time the game changes. It is not the Play Store build.

---

## Step 2 — Google Play developer account ($25, one time)

1. Go to https://play.google.com/console and sign up as an **individual**.
2. Pay the $25 registration fee.
3. Complete identity verification. Google may ask for ID and to verify a phone.

---

## Step 3 — Create your upload key (one time, about 10 minutes)

Google re-signs your app for distribution, but you sign each upload with your own **upload key**. It's a file only you should hold.

**Keep this file and its password safe.** If you lose it, you have to ask Google support to reset it, which takes days.

Install a Java JDK: https://adoptium.net (Temurin 21, Windows installer). Then in PowerShell:

```powershell
keytool -genkeypair -v -keystore vault-nine-upload.jks -alias vaultnine -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password (twice) and some name details; any honest values are fine. Back up `vault-nine-upload.jks` somewhere safe that isn't the GitHub repository.

Copy the key file as text, ready for GitHub:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("vault-nine-upload.jks")) | Set-Clipboard
```

---

## Step 4 — Give GitHub your key so it can build the Play version

On GitHub: **vault-nine → Settings → Secrets and variables → Actions → New repository secret.** Add four:

| Name | Value |
|---|---|
| `VN_KEYSTORE_BASE64` | paste what the command above copied |
| `VN_KEYSTORE_PASSWORD` | the keystore password you chose |
| `VN_KEY_ALIAS` | `vaultnine` |
| `VN_KEY_PASSWORD` | the key password (the same one, unless you chose a different one) |

Then **Actions → Android build → Run workflow**. When it finishes, download the **vault-nine-play-bundle** artifact. Inside is `app-release.aab` — the file you upload to Play.

Secrets are encrypted by GitHub and never appear in the repository or the build logs.

---

## Step 5 — Create the app in Play Console

1. **Create app** → name *Vault Nine* → Game → Free.
2. **Store listing:** copy the text from `LISTING.md`, and upload `icon-512.png`, `feature-1024x500.jpg` and the screenshots from this folder.
3. **App content:** privacy policy URL, ads (No), content rating, target audience, data safety. Every answer is in `LISTING.md`.

---

## Step 6 — Closed test with 12 testers for 14 days

New personal developer accounts must run a **closed test with at least 12 testers, opted in for 14 days in a row**, before Google allows a public release.

1. **Testing → Closed testing → Create track.** Upload `app-release.aab`.
2. Add your testers' Gmail addresses (at least 12; add a few spare in case someone drops out).
3. Send them the opt-in link. Each one must accept it and install the game from Play.
4. Keep the test running for 14 days. Ask testers to actually play — Google can see whether it was used.

This is the slowest step, so line up your testers early: friends, family, a Discord or Reddit community.

---

## Step 7 — Apply for production

After the 14 days, Play Console offers **Apply for production**. Answer its questions about your test, and once approved, publish.

---

## When you update the game

1. I change the game and push.
2. GitHub builds a new test APK and, with your secrets in place, a new Play bundle.
3. Before each Play upload, raise `versionCode` in `android/app/build.gradle` by 1 (Play rejects a repeat). Ask me and I'll do it.
