# Cloud rendering

Cloud rendering produces the same MP4 as "Export" in the editor, but on a server, so you can close the tab. It's a paid-plan feature. The `creator` plan includes 120 minutes a month, up to 4K and 15 minutes per video.

## How a render runs

1. The client creates a job with `POST /v1/renders`. It sends the layout, the export options, and the files the layout uses with their exact sizes. The server checks the plan (resolution, length, minutes left, upload size). At most three renders can be in progress per account.
2. The client uploads each file with `PUT /v1/renders/{id}/media/{mediaId}`, whole or in chunks with `?offset=`. Each response's `Upload-Offset` header gives the bytes received so far. A file is complete when that equals its declared size.
3. `POST /v1/renders/{id}/start` queues the job.
4. A worker claims it. The claim is atomic (`FOR UPDATE SKIP LOCKED`), so several workers can run at once. The claim issues a token scoped to that one job.
5. The worker opens `render.html?job=…&token=…` in headless Google Chrome. The page downloads the layout and files with the token, then renders with the editor's own `exportVideo`, video only. The worker receives the MP4 as a download.
6. The worker muxes the original song into the video as AAC with ffmpeg. If Chrome produced anything other than H.264, ffmpeg re-encodes it to H.264. The worker then uploads the result.
7. The job becomes `done`. Its uploaded files are deleted, and the video is kept for `RENDER_OUTPUT_DAYS` (default 7), then deleted by the API's hourly cleanup. Cleanup retries failed deletions and removes terminal-job files and orphan directories, including files left after account deletion.

Using the editor's export code means cloud and local renders look the same: layer drawing, particles, Milkdrop, fonts and video backgrounds. There's no second renderer to keep in sync.

The built-in fonts (Inter, Nunito Sans, Jost, Gelasio, Anton and Courier Prime) ship with the app, so the worker draws the same text as any browser. Exports wait for them to load. Uploaded fonts travel with the job. Text outside the Latin and Latin Extended ranges falls back to the platform's fonts, which differ between macOS and the worker's Noto set.

## Minutes and billing

- A job counts against the month's minutes from the moment it's created. Cancelled and failed jobs are refunded.
- A finished render adds a usage event whose `units` are seconds of video. That's the number to bill from.
- `GET /v1/usage` reports `renderSecondsThisMonth` and the plan's render limits.

Plans are defined in `server/src/lib/plans.ts`. Until billing exists, set a plan by hand:

```sql
update profile set plan = 'creator' where user_id = (select id from "user" where email = 'someone@example.com');
```

Creation locks the account row and checks monthly minutes and the active-job
limit in the insertion transaction. Concurrent requests share that reservation.
All worker progress, output and failure requests include the `x-job-token`
issued by the current claim, alongside the worker secret. An expired claim
returns 409 and cannot modify or delete the replacement worker's files.
Output uploads are limited to 2,147,483,647 bytes, matching the database field.
Control requests accept at most 2 MiB and thumbnails at most 256 KiB.
Render media uploads stream to disk under the declared per-file size limit.

Roll out API and worker images together when changing the claim protocol.

## Failure handling

| Situation | What happens |
|---|---|
| A file won't decode (corrupt song or clip) | The render page reports the error. The job fails with that message and is refunded |
| The owner cancels | The job token is revoked. The worker sees `continue: false` at its next progress report, stops, and discards its work |
| The worker dies | A running job with no progress for 3 minutes is re-queued once, then failed |
| The render is slower than `RENDER_TIMEOUT_MINUTES` (default 60) | The job fails |

## Running the worker

Development, with the API and the Vite dev server running:

```sh
EDITOR_URL=http://localhost:5173 npm --prefix server run worker
```

It launches the installed Google Chrome (`CHROME_CHANNEL=chrome`). You can point `CHROME_PATH` at another build instead, but Chromium builds can't decode H.264 or AAC files.

In production, the worker runs as the `worker` service in `deploy/compose.yml`, built from `Dockerfile.worker`:

- The image has Google Chrome, ffmpeg, and fonts for text and emoji.
- The service is capped at 2 CPUs and 2 GB of memory, with 1 GB of shared memory for Chrome.
- The image is amd64 only, because Google publishes Chrome for Linux on amd64 only.
- It needs no database access, only `API_URL`, `EDITOR_URL` and `WORKER_SECRET`, so it can run on any host that reaches the API.

The worker renders WebGL (Milkdrop) in software with SwiftShader. That's much slower than a GPU. Passing a GPU into the container (`/dev/dri` for Intel) is the obvious next speed-up.

## Measured locally

These were measured on 2026-09-29 on an Apple M3.

| Render | Setup | Wall time |
|---|---|---|
| 4 s at 720p30, Vinyl template, first job (includes Chrome start-up) | Worker process on macOS, local Chrome | 13 s |
| 20 s at 720p30, Vinyl template, submitted from the editor | Worker process on macOS, local Chrome | 12.4 s |
| 4 s at 720p30, Vinyl template | Production API and worker images, amd64 worker under Rosetta emulation | 8.7 s |
| 4 s at 720p30, Classic template (Milkdrop in software WebGL) | Same | 20.7 s |

In the production images, Chrome encoded H.264 itself, so ffmpeg only copied the video and added AAC audio. Expect different numbers on the deployment host.

## Worker notes

- **Secure context.** WebCodecs needs a secure context. The worker loads the render page from an internal `http://` address, so it tells Chrome to trust exactly that origin (`--unsafely-treat-insecure-origin-as-secure`). Without the flag, every render fails with "This browser cannot encode".
