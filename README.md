# Jesus Embassy Church App — PWA

**Live URL:** https://daviddchucks-hash.github.io/Church-website-/

A Progressive Web App (PWA) for Jesus Embassy RCCG church, built with plain HTML, CSS, and vanilla ES Modules. Hosted on GitHub Pages.

---

## Tech Stack

| Layer       | Technology                                       |
|-------------|--------------------------------------------------|
| Hosting     | GitHub Pages (static)                            |
| Routing     | Hash-based SPA (`js/router.js`)                  |
| Firebase    | App v10.12.0 (CDN), Auth, RTDB, Firestore, FCM  |
| Styling     | Vanilla CSS, custom design system (purple + gold)|
| Fonts       | Cormorant Garamond, Inter (Google Fonts)         |
| PWA         | Service Worker (`service-worker.js`), Web Manifest|
| Notifications | Firebase Cloud Messaging (FCM)               |

---

## Project Structure

```
Church-website-/
├── index.html              — Single-page app shell (all pages embedded)
├── manifest.json           — PWA manifest
├── service-worker.js       — Combined caching + FCM push SW
├── admin.html              — Legacy admin page (password-gated)
├── css/
│   ├── style.css           — Design tokens, reset, utilities
│   ├── components.css      — UI component styles
│   ├── responsive.css      — Responsive breakpoints
│   └── auth.css            — Auth page styles (login/register/profile)
├── js/
│   ├── app.js              — Main entry point (splash, SW, navbar, router init)
│   ├── router.js           — Hash SPA router (pages + route protection)
│   ├── firebase.js         — Firebase initialization (App, RTDB, Firestore, FCM)
│   ├── auth.js             — Firebase Auth module (signUp/signIn/logout/reset)
│   ├── auth-ui.js          — Auth UI logic (forms, nav, route protection)
│   ├── notifications.js    — FCM token management
│   ├── settings.js         — In-app admin panel (password-gated)
│   ├── app-control-client.js — Firebase RTDB app status listener
│   └── install.js          — PWA install prompt handler
└── assets/
    └── icons/              — App icons (192 px, 512 px)
```

---

## Firebase Authentication

Firebase Auth (email + password) was added to allow members to create accounts and sign in.

### Pages

| Page      | Hash        | Auth required |
|-----------|-------------|---------------|
| Login     | `#login`    | ❌ Public     |
| Register  | `#register` | ❌ Public     |
| Profile   | `#profile`  | ✅ Protected  |
| All other pages | any | ✅ Protected  |

### Auth Flow

1. User opens the app → if not signed in, redirected to **`#login`**
2. From login: can sign in, request a password reset, or navigate to `#register`
3. From register: create an account (verification email sent automatically)
4. After sign-in / registration → redirected to `#home` (or previously attempted page)
5. Profile page (`#profile`) shows name, email, join date, verification status
6. Sign-out button on the profile page logs out → redirected to `#login`

### User Data in Firebase RTDB

On registration, a profile is saved to `/users/{uid}`:

```json
{
  "uid": "firebase-auth-uid",
  "fullName": "Grace Emmanuel",
  "email": "grace@example.com",
  "role": "member",
  "createdAt": 1751500000000
}
```

### Firebase Security Rules

After deploying, update your **Firebase Realtime Database Security Rules** to allow user profile writes:

```json
{
  "rules": {
    "appSettings": {
      ".read":  true,
      ".write": true
    },
    "fcm-tokens": {
      ".read":  false,
      ".write": true
    },
    "users": {
      "$uid": {
        ".read":  "auth != null && auth.uid === $uid",
        ".write": true
      }
    }
  }
}
```

> Go to **Firebase Console → Realtime Database → Rules**, paste the rules above, and click **Publish**.

### Admin Panel

The settings page (`#settings`) is still password-gated with `embassy1` — this is a separate admin system for managing FCM notifications and app control modes. It is completely independent of Firebase Auth.

---

## Running Locally

This is a pure static site — no build step needed.

```bash
# Option 1: Python simple server
python3 -m http.server 8080

# Option 2: Node
npx serve . -p 8080
```

Then open: `http://localhost:8080/Church-website-/`

> **Note:** Firebase Auth requires HTTPS or localhost. It will not work on `file://`.

---

## Deployment

The app is deployed via GitHub Pages from the `main` branch.

```bash
git add -A
git commit -m "Your commit message"
git push origin main
```

GitHub Pages automatically serves the updated site within a few seconds.

After each deployment:
1. The Service Worker cache is busted automatically (CACHE_VERSION is bumped on auth-related deployments)
2. Users will see an "Update available" toast — they can click it to reload

---

## Firebase Project

| Setting          | Value                                         |
|------------------|-----------------------------------------------|
| Project ID       | `church-app-637f7`                            |
| Auth Domain      | `church-app-637f7.firebaseapp.com`            |
| RTDB URL         | `https://church-app-637f7-default-rtdb.firebaseio.com` |
| SDK Version      | `10.12.0`                                     |
| Messaging Sender | `534721516086`                                |

### Enable Email/Password Authentication

In the Firebase Console:
1. Go to **Authentication → Sign-in method**
2. Enable **Email/Password** provider
3. Click **Save**

---

## PWA Features

- ✅ Installable (Web Manifest + Install prompt)
- ✅ Offline support (Service Worker caching)
- ✅ Push notifications (Firebase Cloud Messaging)
- ✅ App status control (online / read-only / maintenance / shutdown)
- ✅ Firebase Auth with persistent sessions

---

## Browser Support

Tested on Chrome, Edge, Firefox, Safari (iOS 16.4+). Firebase Auth requires a modern browser with ES Modules support.
