// rxresume-client.ts
// Minimal client for https://v4.rxresu.me
// Currently only verifyCredentials is in use; other methods are reserved for future use.
//
// NOTE (critical): Credentials should never be hardcoded or logged.

type AnyObj = Record<string, unknown>;

export type VerifyResult =
    | { ok: true }
    | {
        ok: false;
        status: number;
        // Message is best-effort; server responses vary.
        message?: string;
        // Some APIs include error codes/details.
        details?: unknown;
    };

export class RxResumeClient {
    constructor(private readonly baseURL = 'https://v4.rxresu.me') { }

    /**
     * Verify a username/password combo WITHOUT persisting a logged-in session.
     *
     * Reality check:
     * - Most sites only expose "verify" by attempting login.
     * - This method does a stateless request to test credentials.
     */
    static async verifyCredentials(
        identifier: string,
        password: string,
        baseURL = 'https://v4.rxresu.me'
    ): Promise<VerifyResult> {
        try {
            const res = await fetch(`${baseURL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ identifier, password }),
                // No credentials mode - we don't want to persist cookies
            });

            if (res.ok) return { ok: true };

            // Best-effort message extraction
            let data: AnyObj = {};
            try {
                const text = await res.text();
                data = text ? (JSON.parse(text) as AnyObj) : {};
            } catch {
                // Ignore JSON parse errors
            }

            const message =
                (typeof data === 'string' ? data : undefined) ??
                (typeof data?.message === 'string' ? data.message : undefined) ??
                (typeof data?.error === 'string' ? data.error : undefined) ??
                (typeof data?.statusMessage === 'string' ? data.statusMessage : undefined);

            return { ok: false, status: res.status, message, details: data };
        } catch (error) {
            return {
                ok: false,
                status: 0,
                message: error instanceof Error ? error.message : 'Network error',
                details: error,
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RESERVED FOR FUTURE USE
    // The following methods support full resume lifecycle management via the
    // RxResume API. They are not currently used but are kept for future features.
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * POST /api/auth/login
     * Returns the auth token on success.
     */
    async login(identifier: string, password: string): Promise<string> {
        const res = await fetch(`${this.baseURL}/api/auth/login`, {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier, password }),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Login failed: HTTP ${res.status} ${text}`);
        }

        const data = (await res.json()) as AnyObj;
        // The API may return the token in different ways
        const token =
            data?.accessToken ??
            data?.access_token ??
            data?.token ??
            (data?.data as AnyObj)?.accessToken ??
            (data?.data as AnyObj)?.token;

        if (!token || typeof token !== 'string') {
            throw new Error(
                `Login succeeded but could not locate access token in response. Response keys: ${Object.keys(data).join(', ')}`
            );
        }

        return token;
    }

    /**
     * POST /api/resume/import
     */
    async create(resumeData: unknown, token: string): Promise<string> {
        const res = await fetch(`${this.baseURL}/api/resume/import`, {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ data: resumeData }),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Create failed: HTTP ${res.status} ${text}`);
        }

        const d = (await res.json()) as AnyObj;
        const id =
            d?.id ??
            (d?.data as AnyObj)?.id ??
            (d?.resume as AnyObj)?.id ??
            (d?.result as AnyObj)?.id ??
            (d?.payload as AnyObj)?.id ??
            ((d?.data as AnyObj)?.resume as AnyObj)?.id;

        if (!id || typeof id !== 'string') {
            throw new Error(
                `Create succeeded but could not locate resume id in response. Response keys: ${Object.keys(d).join(', ')}`
            );
        }

        return id;
    }

    /**
     * GET /api/resume/print/:id
     * Returns the print URL from the response.
     */
    async print(resumeId: string, token: string): Promise<string> {
        const res = await fetch(
            `${this.baseURL}/api/resume/print/${encodeURIComponent(resumeId)}`,
            {
                method: 'GET',
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Print failed: HTTP ${res.status} ${text}`);
        }

        const d = (await res.json()) as AnyObj;
        const url =
            d?.url ??
            d?.href ??
            (d?.data as AnyObj)?.url ??
            (d?.data as AnyObj)?.href ??
            (d?.result as AnyObj)?.url ??
            (d?.result as AnyObj)?.href;

        if (!url || typeof url !== 'string') {
            throw new Error(
                `Print succeeded but could not locate URL in response. Response: ${JSON.stringify(d)}`
            );
        }

        return url;
    }

    /**
     * DELETE /api/resume/:id
     */
    async delete(resumeId: string, token: string): Promise<void> {
        const res = await fetch(
            `${this.baseURL}/api/resume/${encodeURIComponent(resumeId)}`,
            {
                method: 'DELETE',
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        if (!res.ok && res.status !== 204) {
            const text = await res.text();
            throw new Error(`Delete failed: HTTP ${res.status} ${text}`);
        }
    }
}
