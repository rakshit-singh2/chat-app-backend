# Chat app backend

## Environment configuration

The backend supports separate development, staging, and production settings. Copy `.env.example` to `.env.development`, `.env.staging`, or `.env.production` and fill in its values; every setting is explained in the template. Keep real configuration files and credentials out of source control.

Start each environment with:

```sh
npm run dev
npm run start:staging
npm start
```

Set distinct databases, JWT secrets, allowed frontend origins, and S3 buckets for staging and production. AWS credentials should be supplied through the deployment's IAM role or standard AWS credential chain, never committed to the repository. Chat file uploads require an S3 bucket with CORS allowing `PUT` from each frontend origin.

## Email provider

Set `MAIL_PROVIDER` to exactly one of `NODEMAILER` or `SENDGRID`, and set
`MAIL_FROM` to a sender address verified with that service. Only the selected
provider's credential is required:

- **NODEMAILER** requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  and `SMTP_PASSWORD`.
  For Gmail, use `smtp.gmail.com`, port `465`, and `SMTP_SECURE=true`; put a
  Google App Password (not your account password) in `SMTP_PASSWORD`.
- **SENDGRID** requires `SG_KEY`, a SendGrid API key beginning with `SG.`.

Do not configure or commit real credentials for the unused provider. The
backend validates the selected provider's settings during startup.

## Audio and video call providers

Set `STREAMING_SERVICE` to `AGORA` or `MEDIASOUP` to select one provider
for the deployment. The selection is server-side; clients obtain scoped call
credentials from the authenticated API. Existing calls must finish before
changing providers.

- **AGORA** requires the 32-character `AGORA_APP_ID` and
  `AGORA_APP_CERTIFICATE`. Keep the certificate on the backend; the frontend
  receives only short-lived, call-scoped tokens.
- **MEDIASOUP** runs an SFU in this Node process. Set
  `MEDIASOUP_ANNOUNCED_IP` to the host's reachable public IP, open the UDP and
  TCP port range from `MEDIASOUP_MIN_PORT` through `MEDIASOUP_MAX_PORT`, and
  configure `CALL_ICE_SERVERS` as a JSON array of STUN/TURN server objects.
  For example:

  ```env
  CALL_ICE_SERVERS=[{"urls":"turn:turn.example.com:3478","username":"chat","credential":"replace-me"}]
  ```

  Use a TURN service for clients behind restrictive NAT/firewalls. The
  mediasoup worker is process-local, so run one backend instance for a call
  room; horizontal scaling requires a shared signaling/worker allocation
  strategy.

## Authentication

| Piece | How it works |
| --- | --- |
| Passwords | Hashed with bcrypt (cost `BCRYPT_ROUNDS`, default 12), never stored or returned in plain text. Policy: 8–72 bytes with an uppercase letter, a lowercase letter and a digit. |
| Access token | JWT (HS256) signed with `JWT_ACCESS_SECRET`, valid for `ACCESS_TOKEN_TTL` (default 15 min). Send as `Authorization: Bearer <token>` and in the Socket.IO handshake `auth.token`. |
| Refresh token | Random 48-byte value, valid for `REFRESH_TOKEN_TTL` (default 30 days). Only its SHA-256 hash is stored, in the `sessions` collection (one row per device). Rotated on every refresh; replaying an old one revokes that login on every device. |
| Revocation | `POST /auth/logout` ends one session. `POST /auth/logout-all`, a password change and a password reset end every session, invalidate all access tokens immediately (`User.tokenVersion`) and disconnect live sockets. |
| Email codes | 6-digit OTP from `crypto.randomInt`, hashed, valid 10 minutes, at most 5 wrong tries and one email per minute. |
| Rate limits | Per IP+email on login (10 failures/15 min), register/OTP/forgot-password (5/15 min), code checks (20/15 min), plus 1000 requests/15 min per IP overall. |
| Privacy | Login, `send-otp` and `forgot-password` answer the same way whether or not an account exists. Password, OTP and reset fields are never serialised. |

Errors are JSON with a machine-readable `code`, e.g. `{"status":"fail","code":"TOKEN_EXPIRED","message":"..."}`. The full contract is in Swagger at `/api-docs` (development only).

### Web vs mobile clients

| | Web (browser) | Mobile (React Native) |
| --- | --- | --- |
| Identify client | nothing | header `X-Client-Type: mobile` on every `/auth/*` call |
| Refresh token delivery | httpOnly cookie on path `/auth` (JS cannot read it) | `refreshToken` field in the JSON response |
| Store tokens | access token in memory only | refresh token in Keychain/Keystore (e.g. `expo-secure-store` or `react-native-keychain`); access token in memory |
| Refresh | `POST /auth/refresh` with `credentials: include` | `POST /auth/refresh` with body `{ "refreshToken": "..." }` — save the **new** refresh token from the response |
| Logout | `POST /auth/logout` | `POST /auth/logout` with body `{ "refreshToken": "..." }`, then delete it from secure storage |
| Password reset link | `PASSWORD_RESET_URL` (default `<first CORS origin>/auth/new-password`) | `MOBILE_PASSWORD_RESET_URL` if set (a deep link such as `chatapp://reset-password`) |

Native apps do not send an `Origin` header, so CORS does not apply to them.

### Mobile client recipe

1. Log in (or verify/reset) with `X-Client-Type: mobile`; keep `accessToken` in memory and write `refreshToken` to secure storage.
2. Send `Authorization: Bearer <accessToken>` on API calls and `auth: { token }` when connecting Socket.IO (use the function form `auth: (cb) => cb({ token: current })` so reconnects use the latest token).
3. On a 401 with `code` `TOKEN_EXPIRED` (REST) or a socket `connect_error` with message `TOKEN_EXPIRED`, call `/auth/refresh` **once** (share one in-flight request across callers), store the rotated refresh token, then retry the request or reconnect.
4. If refresh returns 401 (`REFRESH_*`), or any call returns `TOKEN_INVALID`, delete the stored token and show the login screen.
5. On app start, if a refresh token is stored, call `/auth/refresh` to get an access token before loading data.

## Production checklist

- Serve the API over HTTPS only. Behind a proxy or load balancer set `TRUST_PROXY` (e.g. `1`) so client IPs, rate limits and secure cookies work.
- Generate a separate `JWT_ACCESS_SECRET` (32+ random characters) per environment. Startup fails outside development if it is missing or short.
- Set `CORS_ORIGINS` to the exact web origins. If the web app and API are on different sites (not just different subdomains), set `REFRESH_COOKIE_SAMESITE=none` (requires `REFRESH_COOKIE_SECURE=true`).
- Use a dedicated MongoDB database per environment; do not share it with other apps.
- `GET /health` returns `{"status":"ok"}` for load-balancer checks.

## File attachments (S3)

Attachments and avatars are uploaded by the browser/app straight to a private S3
bucket using short-lived URLs signed by this server. Three things are needed:

1. **`AWS_REGION` and `S3_BUCKET_NAME`** in the env file.
2. **AWS credentials the server can use.** In production use the server's IAM
   role. For local development create an IAM user limited to the bucket and set
   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env.development` (never
   commit them). Minimal policy (replace the bucket name):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:PutObject", "s3:GetObject"],
       "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
     }]
   }
   ```

   `HeadObject` (used to confirm an upload finished) is covered by `s3:GetObject`.
3. **Bucket CORS** allowing the web app to upload and read:

   ```json
   [{
     "AllowedOrigins": ["http://localhost:5173"],
     "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["*"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 3000
   }]
   ```

   Add each deployed frontend origin to `AllowedOrigins`. Native mobile apps are
   not subject to CORS.

At startup the server logs `File uploads are disabled: …` if credentials are
missing; the app then shows "File sharing isn't set up on the server yet".

## Notifications

- **Notification centre** (`/user/notifications`): friend requests, accepted
  requests, missed calls and group invites. Delivered live over Socket.IO
  (`notification` event) and kept for 90 days.
- **Web Push** (works when the app is closed): set `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (generate keys with
  `npx web-push generate-vapid-keys`). Browsers subscribe via
  `/user/push/subscribe`; the frontend serves `public/sw.js`. Pushes are sent
  only to users without an open connection, and honour their notification
  settings, message-preview setting and muted chats. Logging out removes that
  browser's subscription; "log out everywhere" removes all of them.
- Push requires HTTPS in production (localhost is allowed for development).
- The `PushSubscription` model has a `platform` field (`web` | `fcm` | `apns`)
  so the React Native app can register device tokens later; sending to FCM/APNs
  is not implemented yet.


## Redis and running several instances

Redis is optional. With `REDIS_URL` set, the API can run as several instances
behind a load balancer:

- **Socket.IO** uses the Redis adapter, so events reach users connected to any
  instance.
- **Rate limits** are counted in Redis and apply across all instances (if Redis
  is briefly unavailable, requests are allowed rather than failed).
- **Presence** ("is this user connected anywhere?") asks the whole cluster, so
  online/offline, push decisions and call ringing are correct across instances.
- `GET /health` reports `redis: ok | error | disabled` (503 when Redis is down).

Without `REDIS_URL` everything runs in memory as a single instance, which is
fine for development. Local Redis: `brew install redis && redis-server`, then
`REDIS_URL=redis://localhost:6379`.

Limits: mediasoup calls are still process-local (use Agora, or route all
participants of a call to one instance), and load balancers must support
WebSocket upgrades (or enable sticky sessions for long-polling).

## S3 folder layout

Uploads are grouped by type:

```
avatars/<userId>/<uuid>-<name>
chat/images/<userId>/<uuid>-<name>
chat/videos/<userId>/<uuid>-<name>
chat/audio/<userId>/<uuid>-<name>
chat/documents/<userId>/<uuid>-<name>
```

Files uploaded before this layout (`chat/<userId>/…`) remain valid. The folder
per type makes it easy to apply S3 lifecycle rules (e.g. move `chat/videos/`
to cheaper storage after 90 days) or per-type permissions.
