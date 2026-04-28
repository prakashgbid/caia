# Runbook: Attach a Custom Domain to Cloudflare Pages

**Use case**: You've deployed a new site to `my-site.pages.dev` and want it to be accessible at a custom domain like `mysite.com`.

**Prerequisites**:
- Site is live at `[project].pages.dev`
- You own the domain (registered anywhere — Cloudflare, Namecheap, GoDaddy, etc.)
- DNS is manageable by you

---

## Two Scenarios

### Scenario A: Domain is on Cloudflare (recommended)

If your domain's nameservers are already pointing to Cloudflare, the setup takes 2 minutes and DNS propagates instantly.

### Scenario B: Domain is at another registrar

If your domain is at Namecheap, GoDaddy, etc., you'll add a CNAME record there and wait for DNS propagation (usually 5-30 minutes, sometimes up to 48h).

---

## Step 1: Add the Domain in Cloudflare Pages

1. Go to Cloudflare Dashboard → Workers & Pages → your project
2. Click **Custom domains** tab
3. Click **Set up a custom domain**
4. Enter your domain: `mysite.com` (and optionally `www.mysite.com` as a second entry)
5. Click **Continue**

Cloudflare will show you what DNS record to add. Note the record value.

---

## Step 2: Add DNS Record

### Scenario A: Domain on Cloudflare

Cloudflare will offer to add the DNS record automatically. Click **Activate domain** and the record is added instantly. Skip to Step 3.

If Cloudflare doesn't add it automatically:
- Go to Cloudflare Dashboard → your domain → DNS → Records
- Add CNAME record:
  ```
  Type:    CNAME
  Name:    @   (for root domain)  OR  www  (for subdomain)
  Target:  my-site-name.pages.dev
  Proxy:   Proxied (orange cloud ON)
  ```

### Scenario B: Domain at another registrar

Log into your registrar's DNS management. Add:

```
Type:   CNAME
Name:   @  (or leave blank for root — depends on registrar)
Value:  my-site-name.pages.dev
TTL:    Auto or 3600
```

For root domains (`mysite.com`, not `www.mysite.com`), some registrars don't support CNAME on the apex. In that case, use:
- **ALIAS** or **ANAME** record (Namecheap, Route53, DNSimple support these)
- Or point nameservers to Cloudflare (Scenario A)

For `www.mysite.com`, CNAME works everywhere:
```
Type:   CNAME
Name:   www
Value:  my-site-name.pages.dev
```

---

## Step 3: Wait for DNS Propagation

### Scenario A (Cloudflare DNS): Instant to 2 minutes

### Scenario B (external registrar): 5 minutes to 48 hours

Check propagation:
```bash
# Check from your terminal
dig mysite.com CNAME +short
# Should return: my-site-name.pages.dev.

# Or check globally
# Open: https://dnschecker.org/#CNAME/mysite.com
```

---

## Step 4: SSL Certificate Auto-Provisioning

Cloudflare Pages automatically provisions a TLS certificate via Cloudflare's CA. This happens after DNS propagates. You don't need to do anything.

Verification: In the Cloudflare Pages → Custom domains screen, the domain status should show **Active** (green). If it shows "Pending" for more than 30 minutes, there's a DNS issue.

---

## Step 5: Health Check After Attachment

Once the domain shows **Active**:

1. Visit `https://mysite.com` in an incognito window (to avoid cached redirects)
   - Should load the site over HTTPS
   - No SSL warning
   - Address bar shows `mysite.com`, not `pages.dev`

2. Test redirect from HTTP:
   ```bash
   curl -I http://mysite.com
   # Should return: HTTP/1.1 301 Moved Permanently
   # Location: https://mysite.com/
   ```

3. Test `www` redirect (if set up):
   ```bash
   curl -I https://www.mysite.com
   # Should return: 301 or 308 to https://mysite.com/
   ```
   
   Configure the www redirect in Cloudflare: your domain → DNS → add a CNAME `www → mysite.com`, then Pages → Custom domains → add `www.mysite.com`.

4. Check security headers are present:
   ```bash
   curl -I https://mysite.com | grep -E "strict-transport|x-frame|content-security"
   # Should show HSTS, X-Frame-Options, CSP headers
   ```

---

## Step 6: Update Site Configuration

After domain is confirmed live:

1. Update `SITE_BRAND_LOCK.md` → fill in `domain: mysite.com` and `launched: [date]`
2. Update `next.config.ts` → verify `metadataBase` matches the live domain:
   ```typescript
   // src/app/layout.tsx
   export const metadata: Metadata = {
     metadataBase: new URL('https://mysite.com'),
   };
   ```
3. Update `public/robots.txt` → set the correct `Sitemap:` URL:
   ```
   User-agent: *
   Allow: /
   Sitemap: https://mysite.com/sitemap.xml
   ```
4. Update GA4 property → add `mysite.com` as the site URL (if not already set)
5. Log in `pokerzeno-framework/decisions-log.md` that the domain is live

---

## Troubleshooting

### Domain shows "Failed to verify" in Pages dashboard

Cause: DNS record hasn't propagated yet, or the CNAME target is incorrect.

Fix: Verify the CNAME target exactly matches the `[project].pages.dev` URL shown in the Pages dashboard. Check `dig mysite.com CNAME`. Wait and retry.

### Site loads at `pages.dev` but not at custom domain

Cause: DNS not propagated or CNAME incorrect.

Fix: Use `dig mysite.com +trace` to see the full DNS resolution chain and identify where it breaks.

### SSL certificate error ("Your connection is not private")

Cause: Certificate provisioning hasn't completed yet (can take up to 15 minutes after DNS propagates).

Fix: Wait 15 minutes. If still failing after that, delete and re-add the custom domain in Pages settings to re-trigger certificate provisioning.

### HSTS causes site to be inaccessible after domain change

Cause: Previous HSTS header from `pages.dev` is being enforced by the browser.

Fix: Clear browser HSTS: chrome://net-internals/#hsts → delete domain. This is a browser-specific issue, not a server issue. Users won't encounter it.

### `www` not redirecting to apex

Configure a redirect rule in Cloudflare. Domain → Rules → Redirect Rules → Create rule:
- When incoming URL matches `www.mysite.com/*`
- Redirect to `https://mysite.com/$1` (301)
