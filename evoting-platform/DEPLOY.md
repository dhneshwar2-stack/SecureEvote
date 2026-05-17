# 🗳️ SecureVote — Setup & Deployment Guide

## Project Files
```
evoting-platform/
├── index.html          ← Main SPA (all pages)
├── style.css           ← Styles + 6 themes
├── app.js              ← All logic (voting, admin, face-api)
├── firebase-config.js  ← 🔧 YOU MUST EDIT THIS
└── DEPLOY.md           ← This file
```

---

## STEP 1 — Create a Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → Name it `securevote` → Continue
3. Disable Google Analytics (optional) → **Create project**

---

## STEP 2 — Enable Firebase Services

### A. Firestore Database
1. Left sidebar → **Firestore Database** → **Create database**
2. Choose **Start in test mode** → Select nearest region → **Enable**

### B. Firebase Storage
1. Left sidebar → **Storage** → **Get started**
2. Choose **Start in test mode** → **Done**

### C. Anonymous Auth
1. Left sidebar → **Authentication** → **Get started**
2. Click **Anonymous** → Enable → **Save**

---

## STEP 3 — Get Your Firebase Config

1. Go to **Project Settings** (⚙️ icon) → **General** tab
2. Scroll to **Your apps** → click **</>** (Web)
3. Register app name: `securevote-web` → **Register app**
4. Copy the `firebaseConfig` object shown

---

## STEP 4 — Update firebase-config.js

Open `firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← paste your values
  authDomain: "securevote.firebaseapp.com",
  projectId: "securevote",
  storageBucket: "securevote.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc..."
};
```

---

## STEP 5 — Set Firestore Security Rules

In Firebase Console → Firestore → **Rules** tab, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
> ⚠️ This is for development. Harden before production.

---

## STEP 6 — Set Storage Security Rules

In Firebase Console → Storage → **Rules** tab, paste:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

---

## STEP 7 — Deploy to Firebase Hosting

### Install Firebase CLI (once)
```powershell
npm install -g firebase-tools
```

### Login
```powershell
firebase login
```

### Initialize hosting (run inside evoting-platform folder)
```powershell
firebase init hosting
```
- Select your project `securevote`
- Public directory: **`.`** (just a dot — current folder)
- Single-page app: **No**
- Overwrite index.html: **No**

### Deploy
```powershell
firebase deploy
```

Your site will be live at:
```
https://securevote-XXXXX.web.app
```

---

## STEP 8 — Test Locally (Before Deploy)

Since the site uses Firebase (no build step needed), just open the folder with VS Code and use the **Live Server** extension:
- Right-click `index.html` → **Open with Live Server**

Or use Python:
```powershell
python -m http.server 8080
```
Then open `http://localhost:8080`

---

## 🔑 Default Credentials

| Role  | Credential         |
|-------|--------------------|
| Admin | Password: `admin123` |
| Voter | Register first, then use your Voter ID + face |

---

## 📋 Feature Checklist

- [x] Home page with 3 login options
- [x] Voter registration with face capture (face-api.js)
- [x] Face stored to Firebase Storage
- [x] Voter login with face verification
- [x] Ballot page with candidate cards
- [x] Vote confirmation flow
- [x] Admin login (password: admin123)
- [x] Start / Close polling controls
- [x] Results visible only after polling closed
- [x] Add candidates (name, photo, party symbol)
- [x] Delete candidates
- [x] Polling percentage chart
- [x] 6 themes (Dark, Light, Ocean Blue, Forest, Purple, Crimson)
- [x] Firebase Firestore + Storage integration
- [x] Responsive design (mobile-friendly)
