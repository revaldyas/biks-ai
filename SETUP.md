# Biks.ai — Local Setup

## Prerequisites

- Node.js v20+ — [nodejs.org](https://nodejs.org)
- pnpm — `npm install -g pnpm`

## Steps

**1. Clone & install**
```bash
git clone https://github.com/reva007kali/biks-ai.git
cd biks-ai
pnpm install
```

**2. Buat file `.env`** di root project, isi dengan keys dari team lead:
```env
# Manus Agent API (untuk AI analysis)
MANUS_API_KEY=

# EXA Search API (untuk lead discovery)
EXA_API_KEY=

# Mem0 API (untuk memory feature)
MEM0_API_KEY=

# Resend Email API (untuk kirim email)
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Biarkan seperti ini
JWT_SECRET=local-dev-secret
OAUTH_SERVER_URL=
PORT=3000
```

**3. Jalankan**
```bash
pnpm dev
```

Buka `http://localhost:3000` — selesai, tidak perlu install database atau login.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Port 3000 sudah dipakai | App otomatis pakai port berikutnya (3001, 3002, dst.) |
| `pnpm: command not found` | Jalankan `npm install -g pnpm` dulu |
| API keys tidak jalan | Pastikan tidak ada spasi di sekitar `=` di file `.env` |
| Analyze website lama (2-3 menit) | Normal — Manus agent butuh waktu untuk proses, tunggu saja |
| Analyze website timeout | Coba lagi, Manus kadang butuh retry pertama kali |
