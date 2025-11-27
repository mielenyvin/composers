// server/soundcloudProxy.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;
const SOUND_CLOUD_TOKEN_ENDPOINT = "https://api.soundcloud.com/oauth2/token";
const SOUND_CLOUD_RESOLVE_ENDPOINT = "https://api.soundcloud.com/resolve";

if (!SOUND_CLOUD_CLIENT_ID || !SOUND_CLOUD_CLIENT_SECRET) {
    console.error("Missing SoundCloud credentials in .env");
    process.exit(1);
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let tokenPromise = null;
let tokenCooldownUntil = 0;

// Получаем и кэшируем access_token
async function getAccessToken() {
    const now = Date.now();

    if (cachedToken && now < cachedTokenExpiresAt) {
        return cachedToken;
    }

    // Respect a cooldown after hitting rate limits
    if (tokenCooldownUntil && now < tokenCooldownUntil) {
        const retryIn = Math.max(1, Math.round((tokenCooldownUntil - now) / 1000));
        const err = new Error(`SoundCloud token rate-limited, retry in ${retryIn}s`);
        err.status = 429;
        err.retryAfter = retryIn;
        throw err;
    }

    // Reuse in-flight promise to avoid bursts
    if (tokenPromise) {
        return tokenPromise;
    }

    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", SOUND_CLOUD_CLIENT_ID);
    body.set("client_secret", SOUND_CLOUD_CLIENT_SECRET);

    tokenPromise = (async () => {
        const resp = await fetch(SOUND_CLOUD_TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!resp.ok) {
            const err = new Error(`SoundCloud token error: ${resp.status}`);
            err.status = resp.status;

            // If we are rate-limited, pause future token calls briefly
            if (resp.status === 429) {
                tokenCooldownUntil = Date.now() + 60_000; // 1 minute backoff
            }

            throw err;
        }

        const data = await resp.json();
        if (!data.access_token) {
            throw new Error("SoundCloud token response missing access_token");
        }

        const expiresInSec = data.expires_in || 3600;
        cachedToken = data.access_token;
        cachedTokenExpiresAt = Date.now() + (expiresInSec - 60) * 1000; // небольшой запас

        return cachedToken;
    })();

    try {
        return await tokenPromise;
    } finally {
        tokenPromise = null;
    }
}

// 1) Проксируем resolve плейлиста/трека
app.get("/api/soundcloud/playlist", async (req, res) => {
    try {
        const playlistUrl = req.query.url;
        if (!playlistUrl) {
            return res.status(400).json({ error: "Missing url parameter" });
        }

        const token = await getAccessToken();
        const url =
            `${SOUND_CLOUD_RESOLVE_ENDPOINT}?url=` +
            encodeURIComponent(playlistUrl);

        const resp = await fetch(url, {
            headers: { Authorization: `OAuth ${token}` },
        });

        if (!resp.ok) {
            return res
                .status(resp.status)
                .json({ error: `SoundCloud resolve error: ${resp.status}` });
        }

        const data = await resp.json();
        res.json(data);
    } catch (err) {
        console.error("SoundCloud playlist proxy error", err);
        if (err.status === 429) {
            res.set("Retry-After", err.retryAfter || 60);
            return res
                .status(429)
                .json({ error: "SoundCloud token rate-limited, try again shortly" });
        }
        res.status(500).json({ error: "Internal server error" });
    }
});

// 2) Проксируем /tracks/{id}/streams
app.get("/api/soundcloud/streams/:trackId", async (req, res) => {
    try {
        const trackId = req.params.trackId;
        if (!trackId) {
            return res.status(400).json({ error: "Missing trackId" });
        }

        const token = await getAccessToken();
        const url = `https://api.soundcloud.com/tracks/${trackId}/streams`;

        const resp = await fetch(url, {
            headers: { Authorization: `OAuth ${token}` },
        });

        if (!resp.ok) {
            return res
                .status(resp.status)
                .json({ error: `SoundCloud streams error: ${resp.status}` });
        }

        const data = await resp.json();
        res.json(data);
    } catch (err) {
        console.error("SoundCloud streams proxy error", err);
        if (err.status === 429) {
            res.set("Retry-After", err.retryAfter || 60);
            return res
                .status(429)
                .json({ error: "SoundCloud token rate-limited, try again shortly" });
        }
        res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(PORT, () => {
    console.log(`SoundCloud proxy listening on http://localhost:${PORT}`);
});
