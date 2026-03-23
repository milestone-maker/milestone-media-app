# Milestone Media & Photography — Agent Portal

## Setup Instructions

### 1. Install dependencies
Open your terminal, navigate to this folder, and run:
```
npm install
```

### 2. Run locally
```
npm run dev
```
Then open http://localhost:5173 in your browser.

### 3. Build for production
```
npm run build
```
This creates a `dist/` folder ready to deploy.

### 4. Deploy to Vercel

**Option A — Drag & Drop (easiest):**
1. Run `npm run build`
2. Go to vercel.com → New Project → "Deploy without Git"
3. Drag the `dist/` folder into the upload area
4. Done! Vercel gives you a live URL instantly.

**Option B — GitHub (recommended for ongoing updates):**
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import your repo
3. Vercel auto-detects Vite — just click Deploy
4. Every future `git push` auto-deploys

### 5. Add your custom domain
In Vercel dashboard → your project → Settings → Domains
Add: `app.milestonemediaphotography.com`
