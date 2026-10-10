# «اسأل Claude» — the listener contract

For the maintenance session, which builds the listener that runs on the owner's laptop.
The website never calls Claude. It stores questions and shows answers; the listener
fetches a waiting question, answers it with Claude Code, and posts the answer back.

## Address and token

| Thing | Value |
|---|---|
| Base | `https://itqan-taupe.vercel.app` (local testing: `http://localhost:3000`) |
| Token | env var **`ASK_LISTENER_TOKEN`** — same value on the laptop and in Vercel, 32+ characters |
| Header | `Authorization: Bearer <ASK_LISTENER_TOKEN>` on every call except the file link |
| Body | JSON, UTF-8, `Content-Type: application/json`. Build it with a JSON encoder — a raw line break inside a string is refused (`bad_body`) |

Never put the token in a URL, a log line or a commit. A wrong or missing token answers
`401 {"ok":false,"reason":"unauthorized"}`. If the site's secrets are not set, every call
answers `503 {"ok":false,"reason":"not_configured"}`.

## The loop

```
every 60 s          POST /api/ask/listener/heartbeat
every 5–10 s        GET  /api/ask/listener/next
  for a question →  POST /api/ask/listener/claim      (skip it on 409)
                    …answer it with Claude Code…
                    POST /api/ask/listener/answer     (the answer, or a failure)
```

## 1. Heartbeat — `POST /api/ask/listener/heartbeat`

```json
{ "listener": "fouda-laptop" }
```
→ `200 { "ok": true, "at": 1791634923853, "onlineWindowMs": 180000 }`

`listener` is a free label, optional. The server stamps the time. Send it every minute
even while answering a question (answering can take longer than three minutes).

## 2. Next — `GET /api/ask/listener/next?limit=3`

`limit` 1–10, default 3. Oldest question first. Reading does **not** claim.

```json
{
  "ok": true,
  "now": 1791634923853,
  "claimTtlMs": 300000,
  "questions": [
    {
      "threadId": "3c4d24a49286043bcfec",
      "messageId": "9f1c…",
      "askedAt": 1791634900000,
      "askedBy": "fitter@example.com",
      "messages": [
        { "id": "…", "role": "user", "text": "…", "at": 1791634800000, "photoUrl": "https://…/api/ask/listener/file?t=…" },
        { "id": "…", "role": "assistant", "text": "…", "at": 1791634850000, "photoUrl": null },
        { "id": "9f1c…", "role": "user", "text": "…", "at": 1791634900000, "photoUrl": null }
      ],
      "issue": {
        "row": 14, "date": "2026-08-23", "machine": "PQ 2 — 280", "product": "غطاء زجاجه",
        "category": "ماكينة", "description": "…", "action": "…", "status": "تم", "note": "…",
        "verified": true,
        "issueAudioUrl": null,
        "solutionAudioUrl": null
      },
      "history": {
        "mould": {
          "number": "12", "numberSource": "code", "client": "…", "material": "PE", "cavities": "4",
          "cycleSec": "48", "weightG": "11.7", "knownDefects": null, "notes": null, "duplicatedName": false
        },
        "machineShifts": [
          { "date": "2026-10-07", "shift": "المسائية", "machine": "PQ 2 — 280", "product": "…",
            "goodUnits": 154, "scrapUnits": 26, "scrapSource": "logged", "rowCheck": "سليم" }
        ],
        "mouldShifts": [],
        "mouldIssues": [
          { "date": "2026-09-30", "machine": "…", "product": "…", "category": "…", "description": "…", "action": "…", "status": "…" }
        ],
        "machineIssues": []
      },
      "historyMissing": false,
      "missing": []
    }
  ]
}
```

How to read it:

- **Answer `messageId`** — it is the last entry of `messages`. The earlier entries are the
  thread so far (a follow-up arrives with the first question and its answer above it).
- **`issue` is `null` for a general question**, and then `history` is `null` too.
- **`issue.verified: false`** — the sheet did not confirm the row in time; the fields are
  as the phone sent them and there are no recording links.
- **`null` means "not recorded", never zero.** `scrapUnits: null` with
  `scrapSource: "none"` is a shift whose scrap is unknown. `minutes: null`, `goodUnits: null`
  and every `null` text field are the same. Do not treat any of them as 0.
- **`scrapSource`**: `logged` = «هالك» typed on the row; `system` = counter minus good
  count; `none` = unknown.
- **`history.mould.number`** is the mould number («كود الاسطمبة», else the customer's
  number in Master's notes). `duplicatedName: true` = Master holds this product name
  twice and the first row is shown — say so rather than trusting the standard.
- **`historyMissing: true`** — some of the sheet did not answer within 6 seconds. `missing`
  names the parts: `shifts`, `issues`, `mould`. Those parts are empty in
  `history`; say in the answer that the history was not available rather than that there
  is none.
- Windows: shifts last 10 for the machine and 10 for the product, issues last 10 for the
  mould and 10 for the machine. Newest first.
- **There is no stoppage history** (owner, 2026-10-10): «التوقفات» holds a tapped reason,
  not the exact fault, so it is not sent. What went wrong before, and what fixed it, is in
  the two issue lists — `mouldIssues` (same product) and `machineIssues` (same machine).
  The page offers logged issues as two kinds: mould (`category` «اسطمبة») and machine
  («ماكينة», «كهرباء»).

### Files — `GET <photoUrl>` / `<issueAudioUrl>` / `<solutionAudioUrl>`

The URL is complete and signed; **no token header is needed**. It is good for **10
minutes** from the `next` call that produced it. Expired or altered → `401
{"reason":"bad_or_expired_link"}`: call `next` again for a fresh link (also after a claim
that took long). A photo is `image/jpeg`, at most 450 KB. A recording is the issue's
voice note (`audio/webm` or `audio/mp4`, up to 2 minutes, Arabic).

## 3. Claim — `POST /api/ask/listener/claim`

```json
{ "threadId": "3c4d24a49286043bcfec", "listener": "fouda-laptop" }
```
→ `200 { "ok": true, "threadId": "…", "claimId": "…", "expiresAt": 1791635234734 }`

| Answer | Meaning | Do |
|---|---|---|
| `409 already_claimed` | another listener holds it | skip it |
| `409 not_waiting` | already answered or failed | skip it |
| `404 not_found` | no such thread | skip it |

Two listeners claiming at the same moment: exactly one gets 200.

## 4. Answer — `POST /api/ask/listener/answer`

The answer:
```json
{ "threadId": "…", "claimId": "…", "answer": "…" }
```
or a failure:
```json
{ "threadId": "…", "claimId": "…", "failure": "claude exited with code 1" }
```
→ `200 { "ok": true, "threadId": "…", "status": "answered" }` (or `"failed"`)

| Answer | Meaning | Do |
|---|---|---|
| `409 claim_lost` | the five minutes passed and another listener claimed it | drop this answer |
| `409 already_answered` | a replay — nothing written | treat as done |
| `400 empty_answer` / `answer_too_long` | blank, or over 12,000 characters | shorten and post again |

- **The answer is shown as plain text, in Arabic, on a phone.** Line breaks are kept;
  Markdown is not rendered — no `**`, no `#`, no tables. Short numbered steps read best.
- The screen always shows «دي نصيحة — القرار للفني» under it; the answer need not repeat it.
- **Post a failure rather than nothing.** The person sees the reason (max 300 characters)
  and a «حاول تاني» button that puts the same question back in the queue.

## Timing rules

| Rule | Value |
|---|---|
| Heartbeat | every 60 s. The page shows «Claude متصل» while the last one is under **3 minutes** old |
| Claim lifetime | **5 minutes**. Not answered by then → the question is listed by `next` again |
| Late answer | still accepted after 5 minutes **if nobody re-claimed**; otherwise `claim_lost` |
| File links | 10 minutes |
| Offline | a question asked while the laptop is off stays waiting and is returned by `next` when it is back — oldest first. Nothing expires |
| History budget | 6 s of sheet reads per `next`; then `historyMissing: true` |
| Any call | `503 store_unavailable` = the site could not reach its store; wait and try again |

If one answer can take longer than five minutes, start the claim only when Claude Code is
about to run, and keep one question in flight at a time.

## Try it by hand

```bash
curl -s -H "Authorization: Bearer $ASK_LISTENER_TOKEN" -H "Content-Type: application/json" -d '{"listener":"test"}' https://itqan-taupe.vercel.app/api/ask/listener/heartbeat
```

```bash
curl -s -H "Authorization: Bearer $ASK_LISTENER_TOKEN" "https://itqan-taupe.vercel.app/api/ask/listener/next?limit=1"
```

## What the website side needs (owner)

- Vercel env: `ASK_LISTENER_TOKEN`, `ASK_DATA_KEY` (both 32+ random characters, different
  from each other and from every other key), optional `ASK_DAILY_CAP` (default 20
  questions per user per Cairo day; the owner is not counted).
- `firestore.rules` published with the three `ask*` blocks.
- Who may ask: owner, manager, maintenance.
