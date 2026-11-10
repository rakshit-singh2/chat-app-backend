# Backend Agent Guide

This guide is the shared project context for coding agents. Read it before changing backend behavior. Claude Code users should also load `CLAUDE.md`, which imports this file.

## Project at a glance

Node.js 20.19+ CommonJS service using Express 5, MongoDB/Mongoose 9, Socket.IO 4, JWT authentication, and AWS S3 for private chat attachments and profile images.

## Structure

```text
app.js                         Express middleware, CORS, API docs, route mounting
server.js                      Environment loading, MongoDB, HTTP and Socket.IO server
routes/
  index.js                     API route composition
  auth.js                      Registration, login, OTP, password routes
  user.js                      Profile, friend, call, and attachment routes
config/
  auth.js                      Token/cookie settings, validated at startup
controllers/
  authController.js            Registration, OTP, login, refresh, logout, password reset/change
  userController.js            User, call-token, and profile behavior
models/
  user.js                      User, friend, and presence data (secrets hidden from JSON)
  session.js                   Refresh-token sessions (hashed tokens, rotation families)
  OneToOneMessage.js            Direct conversations and embedded messages
  group.js                     Group chats (members, admins, messages)
  chatSchemas.js               Shared message schema and per-user chat state (pin/archive/mute/read/clear)
  report.js                    Reported messages for moderation
  friendRequest.js             Friend-request persistence
  audioCall.js
  videoCall.js
services/
  tokenService.js              Access-token signing/verification, refresh rotation and revocation
  chatService.js               Socket handlers for direct + group chats, message and chat actions
  presenceService.js           Online/offline/last-seen, cluster-wide via the Socket.IO adapter
  notificationService.js       Notification centre + Web Push
  redis.js                     Optional Redis client (Socket.IO adapter, rate limits)
  mailer.js                    Outbound email
  objectStorage.js             S3 upload/download presigning and object checks
  objectStorage.test.js        Node built-in tests for attachment policy
  callProvider.js              Provider selection and scoped Agora credentials
  mediasoupServer.js           Self-hosted mediasoup worker, rooms, and signaling
utils/
  AppError.js                  Application error type
  catchAsync.js                Async Express controller wrapper
  filterObj.js                 Request field allowlisting
  authResponse.js              Web (httpOnly cookie) vs mobile (JSON body) refresh-token delivery
  rateLimiters.js              API, login, email and code rate limits
  passwordPolicy.js            Password rules shared by register/reset/change
  sanitizeRequest.js           Express 5 compatible NoSQL-injection and XSS cleaning
  errorHandler.js              JSON error responses with machine-readable codes
Templates/Mail/                Email templates
.env.*.example           Environment-specific configuration templates
```

## Important flows and boundaries

- REST APIs are mounted under `/auth` and `/user` by `routes/index.js`. Protected routes use `authController.protect`, which accepts only a short-lived access token in `Authorization: Bearer`.
- Authentication serves both the web app and a React Native app: web clients get the refresh token as an httpOnly cookie, mobile clients (`X-Client-Type: mobile`) in the JSON body. Keep both paths working and documented in `README.md` and `docs/openapi.js` when changing auth.
- `server.js` owns the Socket.IO connection, friend requests and calls; chat events (history, sending, reactions, stars, deletes, forwards, reports, pin/archive/mute/read/clear, groups) live in `services/chatService.js`. Events go to each user's personal room so all devices stay in sync.
- Socket identity comes from a verified JWT in the handshake, not from a client-provided sender ID. Use `socket.userId` as the sender and verify conversation membership before reading or writing messages.
- Direct conversations and messages are persisted in MongoDB through `OneToOneMessage`. Preserve its message field names and the frontend socket payload shape when changing the contract.
- Attachment uploads use authenticated HTTP endpoints to mint short-lived S3 URLs. The client uploads directly to S3; the server validates ownership and object existence before storing the message. Keep AWS credentials on the server/deployment identity. Never accept arbitrary S3 keys or expose permanent public attachment URLs.
- Keep per-environment databases, JWT secrets, CORS origins, and S3 buckets distinct. See `README.md` and `.env.*.example`; never read real secrets into logs or commit them.
- Express and Socket.IO CORS origins must stay aligned with the relevant frontend deployment.
- Audio and video calls use the provider selected by `STREAMING_SERVICE` (`AGORA` or `MEDIASOUP`). Provider credentials and mediasoup room access must be issued only for authenticated call participants; mediasoup also requires a reachable SFU host and configured ICE/TURN infrastructure.

## Change and validation rules

- Keep changes surgical, reuse the controller/service/model boundaries, and return explicit errors for invalid requests. Do not trust a user ID, recipient, conversation ID, attachment key, or message type supplied by the browser without validating it against the authenticated user and stored data.
- Add or update focused tests for behavior changes. Use Node's built-in test runner:

  ```sh
  npm test
  node --check server.js
  node --check controllers/userController.js
  ```

- Before finishing, run the focused tests and `npm audit`. State clearly if a database, email provider, Agora account, or S3 integration could not be exercised due to missing environment configuration.
- For full-stack browser regressions, run the frontend against a non-production backend and use the configured Playwright MCP to exercise the UI, Socket.IO message delivery, and attachment flow. Never point browser tests at production data.

## Required UI test IDs

When changing the frontend as part of a backend/full-stack task, every interactive element you add or touch must have a stable, descriptive `data-testid`. This includes buttons, icon buttons, links, text fields, file inputs, selects, checkboxes, switches, tabs, menu items, and custom clickable/keyboard controls. Add the attribute to the actual interactive element, not only its wrapper. Use readable kebab-case names such as `chat-send-button` and `chat-attachment-input`; keep accessible names/labels as well. When editing a UI area, add IDs to legacy interactive controls in that area if they are missing.

## Playwright MCP browser matrix

Use Playwright MCP browser automation for interactive cross-browser checks when the MCP is available. Run the same relevant UI flow in each configured target:

| Requested browser | Playwright target                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Safari            | Playwright WebKit, Safari's engine approximation. Do not report this as native Safari testing. |
| Google Chrome     | Chromium with the `chrome` browser channel                                                     |
| Brave             | Chromium using the installed Brave executable path, if the MCP supports a custom executable    |
| Microsoft Edge    | Chromium with the `msedge` browser channel                                                     |

Check each browser is actually installed and selectable before testing it. Do not invent MCP configuration keys or claim a browser was covered when it was unavailable. If Playwright MCP or a requested browser is unavailable, report the limitation and use the project's available automated tests; do not silently substitute one browser for another.
