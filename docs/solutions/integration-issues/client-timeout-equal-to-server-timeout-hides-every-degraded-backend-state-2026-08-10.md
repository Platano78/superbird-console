---
title: "Client timeout equal to server timeout hides every degraded backend state"
date: "2026-08-10"
track: bug
problem_type: integration_issue
category: integration-issues
tags: ["timeout", "fetch", "abortcontroller", "observability", "degraded-state", "polling", "car-thing", "client-server", "failure-modes", "verification"]
module: "car-thing/device + services/deviceinfo"
component: "useDeviceInfo poll / GET /state"
root_cause: "The client's fetch abort timeout (2000ms) was exactly equal to the service's per-source timeout (2000ms), so any degraded source made /state take the full 2.00s and the client aborted at the same instant the server replied."
resolution_type: "code_fix"
symptoms: ["UI shows a generic 'service unreachable' panel while the service is demonstrably up", "A manual fetch from the same page devtools console returns 200 with valid JSON", "Device-side wget/curl to the same URL succeeds", "The failure survives a full page reload, so it does not look like a latched state bug", "No CORS error, no console exception, no failed network entry", "Only reproduces when some upstream dependency is actually down"]
---

## Problem

A polling client rendered `deviceinfo service unreachable` for every slot of a dashboard, while the service was up and answering correctly. The state the UI was *supposed* to display — "the router is down, here is a button to start it" — could never appear.

The deeper issue is a class, not an instance: **the client could not observe any degraded backend state, because degradation was precisely what made the response too slow to receive.** All the careful per-source error handling in the service was unreachable by construction.

## Symptoms

- Every slot showed a generic unreachable panel.
- `fetch()` typed manually into the page returned `200` with valid JSON — `FETCH OK router.available=false`.
- A device-side `wget` to the identical URL returned `{"ok":true}`.
- Survived a hard reload, which ruled out a latched React state bug.
- No CORS error, no exception, nothing in the console.
- Worked perfectly whenever every upstream was healthy.

That combination — client fetch works when invoked by hand, fails when invoked by the app, no errors anywhere — is the fingerprint.

## What didn't work

- **Suspecting a latched failure flag.** Reasonable: the hook sets `reachable:false` in `catch`. Disproved by a full reload still showing the failure.
- **Suspecting CORS.** Plausible on a `file://` origin, and a real bug earlier in the same project. Disproved: no CORS message, and a manual fetch succeeded from the same origin.
- **Suspecting `AbortController` on an old browser** (Chromium 69). Tested both forms in the live page:
  ```js
  fetch(url)                      // OK 200
  fetch(url, { signal: c.signal }) // OK 200
  ```
  Both fine.
- **Reading the hook's code.** It looked correct, and it *was* correct. The bug was not visible in either file alone — only in the relationship between two constants in two different files.

## Root cause

```
device/src/deviceInfo.ts        FETCH_TIMEOUT_MS  = 2000   // client abort
services/deviceinfo/server.js   SOURCE_TIMEOUT_MS = 2000   // per-source
```

The service fans out to several sources in parallel and gives each a 2s timeout. When every source is healthy it answers in milliseconds. When **any** source is down, it waits the full 2s for that source before responding.

Measured, warm and cold cache:

```
/state attempt 1: 2.001823s (http 200)
/state attempt 2: 2.002942s (http 200)
/state attempt 3: 2.000939s (http 200)
COLD-CACHE      : 2.004228s
```

The client aborted at 2000ms — the same instant the server replied — and lost the race every time. The abort surfaced as a generic catch, which the UI rendered as "service unreachable".

So the system had exactly inverted behaviour: **healthy backend → accurate UI; degraded backend → UI claims the whole service is dead.**

## Solution

Raise the client timeout above the server's worst case, and keep it below the poll interval:

```ts
// MUST stay comfortably ABOVE the service's per-source timeout (2000ms) and BELOW POLL_MS (5000).
const FETCH_TIMEOUT_MS = 4500
```

Document the relationship at both ends so neither constant can be tuned in isolation.

## Why it works

The server's worst case is bounded: sources run in parallel via `Promise.all`, so a fully degraded response is ~one source timeout (2s) plus overhead, not the sum. A 4500ms client budget clears that with margin while still finishing before the next 5s poll, so polls never overlap.

The ordering constraint is the real content:

```
server worst-case response  <  client timeout  <  client poll interval
         ~2.0s              <     4.5s         <        5.0s
```

## Prevention

- **Never set a client timeout equal to (or below) the server's internal timeout.** Equal values are worse than too-short ones, because they produce a race that passes in testing and fails only in production degradation.
- **A per-source-timeout design implies a client-timeout budget.** If a service promises "each source degrades independently and honestly", the client must allow enough time to *receive* that honesty. Otherwise the graceful-degradation code is dead code.
- **Test the failure state, not just the happy path.** This shipped green: build passed, all gates passed, the normal path worked, and the screenshot looked right. It was found only by *simulating the failure* — a modified copy of the service pointed at a dead port, so the real dependency was never touched:
  ```bash
  sed "s|127.0.0.1:8081|127.0.0.1:9099|" server.js > server-test.js
  node server-test.js &   # real service left alone; verified still HTTP 200
  ```
- **Suspect cross-file constant relationships when each file reads correct in isolation.** Grep both sides for timeout constants and compare them, rather than re-reading one file harder.
- **Diagnostic that isolates it fast:** if a manual `fetch` from the page console succeeds while the app's identical fetch fails, and there are no console errors, measure the endpoint's *wall-clock* response time under the failing condition and compare it against the client's abort budget.
