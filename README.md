# Acron ARF — Schedule Request

Browser form that fills `Master.pdf` (Acron ARF template). Data stays on the device unless you download a PDF.

## Edit in Cursor

Open the folder `/Users/hw/acron-arf-scheduler` (or your clone path) in Cursor. After changes, commit and push so GitHub Pages updates.

## Local preview

Serve this directory over HTTP (Safari needs HTTP for `fetch`). Prefer **`serve.py`** so Safari’s normal window does not keep stale `app.js` / `styles.css` (Private Browsing often looks “updated” because it starts with an empty cache):

```bash
cd /path/to/acron-arf-scheduler
python3 serve.py -p 8080
```

Open `http://127.0.0.1:8080/` in Safari. (`python3 -m http.server` works but caches aggressively.)

After you deploy to **GitHub Pages**, bump the `?v=` query on `styles.css` and `app.js` in `index.html` when you want every visitor to pull new assets without waiting on CDN cache.

## GitHub Pages

1. **Create the git repo** (once). If `git init` fails inside Cursor, run in Terminal:

   ```bash
   bash scripts/bootstrap-repo.sh
   ```

2. On GitHub: **New repository** → copy the HTTPS URL.

3. **Push:**

   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

4. **Enable Pages:** Repository **Settings → Pages → Build and deployment → Deploy from a branch** → Branch **main**, folder **/ (root)** → Save.

5. After a minute or two, open the site URL shown on the Pages settings page in Safari. `app.js` loads `Master.pdf` and `courses.json` using paths relative to the script, so it works for both `https://<user>.github.io/<repo>/` and root sites.

## Private PDF download counter (admin-only)

GitHub Pages is static, so the only reliable way to get real-time download counts is to send a small “track” request to your own private backend.
This repo includes a Cloudflare Worker that counts “Download filled ARF PDF” clicks.

### Deploy the Worker (Cloudflare)

1. Install and login:

```bash
cd download-counter-worker
npm install
npx wrangler login
```

2. Create KV and update `wrangler.toml`:

```bash
npx wrangler kv namespace create COUNTERS
```

Copy the KV namespace id into `download-counter-worker/wrangler.toml` under `kv_namespaces.id`.

3. Set a private admin token (do NOT commit it):

```bash
npx wrangler secret put ADMIN_TOKEN
```

4. Deploy:

```bash
npm run deploy
```

Wrangler prints your Worker URL (example: `https://arf-download-counter.<you>.workers.dev`).

### Enable tracking in the web app

In `app.js`, set:

- `DOWNLOAD_COUNTER_BASE_URL = "https://arf-download-counter.<you>.workers.dev"`

Then commit + push so GitHub Pages updates.

### View counts (admin-only)

Open `admin-downloads.html` from your GitHub Pages site, paste:

- Worker base URL
- Admin token (your secret)

It calls `GET /admin` with `X-Admin-Token`. Without the token it returns 401.

## Optional CLI

`fill_arf_pdf.py` fills the same template from JSON; not required for the web app.
# Acron-arf-scheduler
