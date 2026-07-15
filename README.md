# Site Morning Monitor (free, cloud, PC off)

Har subah 10:00 AM (PKT) GitHub ke free cloud pe automatically chalta hai — tera
PC band ho tab bhi. Teri website ko real visitor ki tarah kholta hai, front-end
problems dhoondta hai (broken images, blank sections, console errors, failed
requests, 404, missing prices/buttons), Google **Gemini (free tier)** se ek short
summary banwata hai, aur wo summary **email** (aur optionally WhatsApp) pe jis
banday ko bole us tak bhej deta hai. Wo banda dekh ke fix karega aur khud reply karega.

Koi API kharcha nahi. Gemini free tier + GitHub Actions free = **bilkul free.**

## Setup (poora cloud — kuch install nahi karna)
Steps ke liye chat me di gayi simple guide follow karo. Short version:
1. Free Gemini key: https://aistudio.google.com/apikey
2. Gmail App Password (2-Step Verification on karke).
3. Ye files ek **private GitHub repo** me upload karo.
4. Repo Settings > Secrets me keys daalo (neeche list).
5. Actions tab se ek dafa manually run karke test karo. Ho gaya.

## GitHub Secrets ki list
`GEMINI_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO`
(WhatsApp chahiye to: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_TO`)

## config.json
Kaunse pages check karne hain wo `config.json` me hain. **Sample Product** wali
line me ek asli product handle daalna (jo URL me /products/ ke baad aata hai).
Jitne chaho pages add kar sakte ho.

## Files
```
site-morning-monitor/
├─ config.json                 # kaunse pages check karne hain
├─ .env.example                # (sirf local test ke liye) secrets template
├─ package.json
├─ src/
│  ├─ index.js                 # orchestrator (+ failure alert email)
│  ├─ checkSite.js             # Playwright: visit + problems + screenshot
│  ├─ analyze.js               # Gemini (free) -> summary
│  └─ notify.js                # email + optional WhatsApp
└─ .github/workflows/
   └─ daily-check.yml          # 10am PKT cron (cloud, PC off)
```

## Notes
- GitHub free scheduler kabhi 5–20 min late chal sakta hai (high load). Roz ke
  monitoring ke liye ye theek hai.
- Gemini free tier is kaam ke liye kaafi hai (roz sirf 1 run, chand images).
- WhatsApp optional + setup wala (Twilio). Khali chhod do to sirf email jayegi.
