# Demo runbook: vendor-managed POC with file and image attachments

A script for showing the vendor platform and customer A's chat with documents, images and the knowledge base, then customer B, which runs on the same platform with its own brand, models and limits. Every step below was rehearsed on 2026-11-05 with Local Mock, plus three Gemini requests ($0 on the free tier); customer B's steps on 2026-11-11 with Local Mock only. The sample files are in [docs/demo](demo) and are fictional.

## Before the demo day

1. Pull `main` and rebuild the images once: `npm run platform:build` (about 2.5 minutes with the build cache, longer without it). It also builds customer B's web with the ACME brand (`"brand": "acme"` in `deploy/tenants/b.json`).
2. Run the platform commands from Windows Terminal or PowerShell, **not a VS Code terminal**. `.vscode/settings.json` loads the root `.env` into VS Code terminals, and Docker Compose would then give the platform the single-installation stack's keys.
3. In customer A, delete old test chats from `tenant-admin`'s sidebar, so the audience sees only the demo.
4. Customer A's knowledge base must hold `company-policy.md` (status Ready) with these settings (_Knowledge base_ page, as `tenant-admin`):

   | Setting              | Value                  | Why                                                                       |
   | -------------------- | ---------------------- | ------------------------------------------------------------------------- |
   | Embedding model      | Mock Embedding · Local | No embedding cost; it matches words, not meaning                          |
   | Top-K                | 5                      |                                                                           |
   | Minimum score        | 0.15                   | Passages from other files (the English rulebook) stay out of Thai answers |
   | Chunk size / overlap | 600 / 120              | Each policy topic becomes its own passage                                 |

   If the file is missing, upload [docs/demo/company-policy.md](demo/company-policy.md). Do not upload a Thai PDF: its text comes out with spaces inside words and missing tone marks.

## On the day

### Start (about 75 seconds once Docker runs)

1. Start Docker Desktop (`C:\Program Files\Docker\Docker\Docker Desktop.exe`) and wait until `docker info` answers.
2. If the single-installation stack in the repo root is running, stop it with the same `-f` files it was started with. It holds about 2 GiB of the Docker VM's memory.
3. Start the platform, then customers A and B:

   ```powershell
   node scripts/platform/platform.mjs up       # about 40 s
   node scripts/platform/tenant.mjs create a   # about 30 s; safe to re-run
   node scripts/platform/tenant.mjs create b   # about 30 s; the first run also creates its realm and $2 credit
   node scripts/platform/tenant.mjs status a   # credit, models, knowledge, images
   ```

### Warm up (2 minutes, before the audience arrives)

| Check            | Where                                                                                               | Expected                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Vendor console   | http://localhost:4070, `vendor-admin`, password `VENDOR_CONSOLE_PASSWORD` in `deploy/platform/.env` | _Customer A_ is Active with credit left                                          |
| Customer sign-in | http://localhost:3100, `tenant-admin`, password `TENANT_ADMIN_PASSWORD` in `deploy/tenants/a.env`   | Chat page opens                                                                  |
| Model list       | Model field above the composer                                                                      | _Local Mock_ and _Gemini 3.5 Flash-Lite_ are Available and tagged _Reads images_ |
| Customer B       | http://localhost:3200, `tenant-admin`, password `TENANT_ADMIN_PASSWORD` in `deploy/tenants/b.env`   | _ACME Assistant_ in Thai, in teal; _Local Mock_ is พร้อมใช้งาน                   |
| Knowledge base   | _Knowledge base_ page                                                                               | `company-policy.md` is Ready                                                     |

Never open the `.env` files on the shared screen; copy the passwords beforehand.

## Demo script

Use _Gemini 3.5 Flash-Lite_ for steps 2–4. Gemini's wording varies between runs; the facts in the expected answers do not.

### 1. Vendor console: one platform, many customers

- _Tenants_: each customer's prepaid test credit, consumed amount and requests. No real payment is collected.
- Open _Customer A_:
  - _Image limits_: which vision models customer A may use (`local-mock`, `google-gemini`, `groq-vision`, `openrouter-free`) and how many images a chat may hold (6). Below it, what Groq and OpenRouter take whatever the limit says (2 and 4).
  - _Knowledge (RAG) limits_: embedding models, file types and sizes the vendor allows customer A, with what it uses now.
- _Pricing_: the sale price per model; every change is a new version, and running requests keep the price they started with.

### 2. An image in the chat

1. _New chat_, choose _Gemini 3.5 Flash-Lite_, untick _Knowledge base_.
2. Attach [docs/demo/receipt.png](demo/receipt.png). The browser resizes it before upload. Point out the external-model notice above the composer.
3. Ask: `ใบเสร็จนี้มาจากร้านอะไร วันที่เท่าไร และยอดรวมทั้งสิ้นเท่าไร`
4. Expected: ร้านอาหารบ้านตัวอย่าง, 3 พฤศจิกายน 2569, 670.00 บาท (rehearsal: 1,286 tokens in, 6.5 s).
5. Click the image in the message to open the viewer.

### 3. A document in the chat

1. _New chat_, Gemini, _Knowledge base_ unticked.
2. Attach [docs/demo/meeting-notes.txt](demo/meeting-notes.txt).
3. Ask: `สรุปงานที่แต่ละคนต้องทำ พร้อมกำหนดส่ง`
4. Expected: คุณปิติ OTP by 11 Nov, คุณชูใจ notification design by 8 Nov, คุณวีระ speed test by 7 Nov, คุณมานี customer meeting by 6 Nov (rehearsal: 514 tokens in, 7.5 s).

### 4. The knowledge base, alone and with an image

1. Show the _Knowledge base_ page: the file, its passages and the settings above.
2. _New chat_, Gemini, _Knowledge base_ ticked. Ask one of these tested questions. Mock embeddings match words, so ask with the document's own words:

   | Question                                   | Answer in the policy | Score |
   | ------------------------------------------ | -------------------- | ----- |
   | `ลาพักร้อนได้กี่วันต่อปี`                  | 12 working days      | 0.36  |
   | `ทำงานจากที่บ้านได้สัปดาห์ละกี่วัน`        | at most 2            | 0.39  |
   | `ส่งใบเสร็จเพื่อเบิกได้ภายในกี่วัน`        | 30 days              | 0.37  |
   | `ค่ารับรองลูกค้าเบิกได้ไม่เกินเท่าไร`      | 1,500 baht           | 0.36  |
   | `ลาป่วยติดต่อกันกี่วันต้องมีใบรับรองแพทย์` | more than 2 days     | 0.31  |
   | `ส่งข้อมูลลูกค้าให้บริการ AI ภายนอกได้ไหม` | no, company AI only  | 0.17  |

   A question in other words (for example `โน้ตบุ๊กหาย` instead of `อุปกรณ์สูญหาย`) can score below 0.15 and is answered without the policy.

3. The highlight: _New chat_, Gemini, _Knowledge base_ ticked, attach `receipt.png` and ask `ใบเสร็จนี้เบิกเป็นค่ารับรองลูกค้าได้ไหม ค่ารับรองลูกค้าเบิกได้ไม่เกินเท่าไรต่อครั้ง`. Expected: yes, 670 baht is within the 1,500-baht limit and the receipt has the shop, date and total; the customer's name must be added (rehearsal: 1,991 tokens in, 5 s).
4. Answers mark their sources as `[S1]`, `[S2]`. The chat does not list the sources (removed in `664d38e`); to show them, use _Export chat_ → _Export Markdown_, which lists each source's excerpt.

### 5. Credit and the vendor's ledger

- Customer A: _Test credits & billing_ (`/billing`) shows the credit used and the latest ledger entries and requests. An image is billed as input tokens, about 1,120 per image a turn for Gemini (2,048 for Groq and OpenRouter); there is no separate image price.
- Vendor console: customer A's page, _Ledger_ → _Requests_, lists the same requests.

### 6. A second customer: its own brand, models and limits

1. Vendor console, _Tenants_: _Customer A_ and _Customer B_, each with its own credit.
2. Open _Customer B_ → _Image limits_: only `local-mock` and `google-gemini`. Its plan has no `groq-vision`, and `openrouter-free` there is text only. Compare with customer A's four models.
3. Open http://localhost:3200 in a private window and sign in as customer B's `tenant-admin`: _ACME Assistant_, in Thai and teal, from the same platform and the same API image.
4. Open the model field: _Qwen3.8 27B (Groq)_ and _OpenRouter Free Models_ have no _อ่านรูปได้_ tag, while customer A's list tags both _Reads images_. Customer B signs in to its own realm and sees none of customer A's chats or documents.

## If something goes wrong

| Problem                                                                          | What to do                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model shows _Unavailable_ or "0 model(s) available" right after start          | Wait: the chat page checks again after 5 seconds, then less often. Reload if it stays.                                                                                           |
| Gemini refuses or is slow (free-tier limits)                                     | Customer A may send Gemini 5 requests a minute and 33 requests or 33,333 tokens a day, rehearsals included. Switch to _Local Mock_, which shows the same flow with a mock reply. |
| Local Mock refuses: "This chat and its files are longer than this model accepts" | Untick _Knowledge base_. Local Mock holds 8,192 tokens; with the settings above a knowledge question fits, but a file plus retrieved passages can fill them.                     |
| A review prompt about sensitive information                                      | A message or passage contains something like an email address or phone number, which is checked before anything goes to an external model. The demo files contain none.          |
| Credit runs out                                                                  | Vendor console → _Customer A_ → _Grant credit_, or `node scripts/platform/tenant.mjs credits a 5`.                                                                               |
| A Thai PDF answer looks garbled                                                  | Known: Thai text extracts badly from PDFs. Use Markdown, TXT or an image instead.                                                                                                |
| `tenant.mjs create b` stops: `enterprise-ai/web:brand-acme is missing`           | The ACME web image was not built. Stop the platform (`node scripts/platform/platform.mjs down`), run `npm run platform:build`, then start again.                                 |

## After the demo

Stop the containers and keep the data:

```powershell
docker ps -q --filter "name=^platform-" --filter "name=^tenant-a-" --filter "name=^tenant-b-" | ForEach-Object { docker stop $_ }
```

Do not use `tenant:down` for this: it also suspends the customer in the vendor ledger. Delete the demo chats from the sidebar if the next run should start clean; the knowledge base file can stay.
