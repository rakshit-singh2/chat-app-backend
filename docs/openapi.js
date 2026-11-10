"use strict";

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonRequest = (schema) => ({
  required: true,
  content: {
    "application/json": {
      schema,
    },
  },
});
const jsonResponse = (description, schema) => ({
  description,
  content: {
    "application/json": {
      schema,
    },
  },
});
const apiError = (description) =>
  jsonResponse(description, ref("ErrorResponse"));
const successMessage = (description) =>
  jsonResponse(description, ref("MessageResponse"));
const protectedOperation = (summary, tags, responses, extra = {}) => ({
  summary,
  tags,
  security: [{ bearerAuth: [] }],
  responses,
  ...extra,
});

module.exports = {
  openapi: "3.0.3",
  info: {
    title: "Chat App API",
    version: "1.0.0",
    description: [
      "Authentication, user, attachment, and audio/video call REST APIs.",
      "",
      "**Tokens.** Login, verify, reset-password and change-password return a short-lived",
      "`accessToken` (send as `Authorization: Bearer <token>`) and a long-lived refresh token.",
      "Browsers receive the refresh token only as an httpOnly cookie scoped to `/auth`.",
      "Native apps send the header `X-Client-Type: mobile` and receive `refreshToken` in the",
      "JSON body; they send it back in the body of `/auth/refresh` and `/auth/logout`.",
      "Refresh tokens rotate on every use; replaying an old one revokes that login on all devices.",
      "",
      "**Errors** include a machine-readable `code` (e.g. `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`,",
      "`EMAIL_NOT_VERIFIED`, `RATE_LIMITED`). On `TOKEN_EXPIRED`, call `/auth/refresh` and retry.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "Current backend host" }],
  tags: [
    { name: "Auth", description: "Registration and account authentication" },
    { name: "User", description: "Current user, contacts, and attachments" },
    { name: "Call", description: "Call provider credentials and call history" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    parameters: {
      ClientType: {
        name: "X-Client-Type",
        in: "header",
        required: false,
        description: "Set to `mobile` in native apps to receive the refresh token in the response body.",
        schema: { type: "string", enum: ["web", "mobile"] },
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "fail" },
          code: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string", example: "Invalid request." },
        },
        required: ["message"],
      },
      MessageResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          message: { type: "string" },
        },
        required: ["status", "message"],
      },
      UserSummary: {
        type: "object",
        properties: {
          _id: { type: "string", example: "665f1a3e6e8f4e3b1a2c9d01" },
          firstName: { type: "string", example: "Jane" },
          lastName: { type: "string", example: "Smith" },
          avatar: { type: "string", nullable: true },
        },
      },
      AuthResponse: {
        allOf: [
          ref("MessageResponse"),
          {
            type: "object",
            properties: {
              accessToken: { type: "string", description: "Short-lived JWT access token." },
              accessTokenExpiresIn: { type: "integer", description: "Seconds until the access token expires." },
              refreshToken: {
                type: "string",
                description: "Only for `X-Client-Type: mobile`. Browsers get an httpOnly cookie instead.",
              },
              refreshTokenExpiresIn: { type: "integer", description: "Mobile only." },
              user_id: { type: "string" },
            },
            required: ["accessToken", "accessTokenExpiresIn", "user_id"],
          },
        ],
      },
      UserResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: {
            type: "object",
            description: "Current user profile.",
            properties: {
              _id: { type: "string" },
              firstName: { type: "string" },
              lastName: { type: "string" },
              email: { type: "string", format: "email" },
              avatar: { type: "string", nullable: true },
              about: { type: "string", nullable: true },
              verified: { type: "boolean" },
              friends: { type: "array", items: { type: "string" } },
            },
          },
        },
        required: ["status", "data"],
      },
      UserListResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          message: { type: "string" },
          data: { type: "array", items: ref("UserSummary") },
        },
        required: ["status", "data"],
      },
      FriendRequestListResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          message: { type: "string" },
          data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                _id: { type: "string", description: "Friend request ID." },
                sender: ref("UserSummary"),
                recipient: { type: "string", description: "Recipient user ID." },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
        required: ["status", "data"],
      },
      CallStartResponse: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              from_user: ref("UserSummary"),
              callId: { type: "string" },
              roomID: { type: "string" },
              provider: { type: "string", enum: ["AGORA", "MEDIASOUP"] },
              userID: { type: "string" },
              peerID: { type: "string" },
              userName: { type: "string" },
            },
            required: ["callId", "roomID", "provider", "userID", "peerID"],
          },
        },
        required: ["data"],
      },
      CallProviderResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: {
            type: "object",
            properties: {
              provider: { type: "string", enum: ["AGORA", "MEDIASOUP"] },
              iceServers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    urls: {
                      oneOf: [
                        { type: "string" },
                        { type: "array", items: { type: "string" } },
                      ],
                    },
                    username: { type: "string" },
                    credential: { type: "string" },
                  },
                  required: ["urls"],
                },
              },
            },
            required: ["provider", "iceServers"],
          },
        },
        required: ["status", "data"],
      },
      CallCredentialsResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: {
            oneOf: [
              {
                type: "object",
                properties: {
                  provider: { type: "string", enum: ["AGORA"] },
                  roomId: { type: "string" },
                  userId: { type: "string" },
                  userName: { type: "string" },
                  token: { type: "string" },
                  appId: { type: "string" },
                },
                required: [
                  "provider",
                  "roomId",
                  "userId",
                  "token",
                  "appId",
                ],
              },
              {
                type: "object",
                properties: {
                  provider: { type: "string", enum: ["MEDIASOUP"] },
                  roomId: { type: "string" },
                  userId: { type: "string" },
                  userName: { type: "string" },
                  iceServers: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        urls: { type: "string" },
                        username: { type: "string" },
                        credential: { type: "string" },
                      },
                      required: ["urls"],
                    },
                  },
                },
                required: ["provider", "roomId", "userId", "iceServers"],
              },
            ],
          },
        },
        required: ["status", "data"],
      },
      UploadUrlResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: {
            type: "object",
            properties: {
              key: { type: "string" },
              uploadUrl: {
                type: "string",
                format: "uri",
                description: "Short-lived URL for uploading the object.",
              },
            },
            required: ["key", "uploadUrl"],
          },
        },
        required: ["status", "data"],
      },
      CallLogsResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          message: { type: "string" },
          data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                img: { type: "string", nullable: true },
                name: { type: "string" },
                online: { type: "boolean" },
                incoming: { type: "boolean" },
                missed: { type: "boolean" },
              },
              required: ["id", "name", "online", "incoming", "missed"],
            },
          },
        },
        required: ["status", "data"],
      },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        summary: "Register an account and send a verification code",
        tags: ["Auth"],
        description:
          "Creates (or restarts) an unverified account and emails a 6-digit code valid for 10 minutes. Password: 8+ characters with upper, lower and a digit.",
        requestBody: jsonRequest({
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password", minLength: 8 },
          },
          required: ["firstName", "lastName", "email", "password"],
        }),
        responses: {
          201: successMessage("Account created and verification code sent."),
          400: apiError("Missing fields, invalid email or weak password."),
          409: apiError("Email already in use (EMAIL_IN_USE)."),
          429: apiError("Too many requests (RATE_LIMITED)."),
        },
      },
    },
    "/auth/verify": {
      post: {
        summary: "Verify the registration code and sign in",
        tags: ["Auth"],
        parameters: [{ $ref: "#/components/parameters/ClientType" }],
        requestBody: jsonRequest({
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            otp: { type: "string", minLength: 6, maxLength: 6 },
          },
          required: ["email", "otp"],
        }),
        responses: {
          200: jsonResponse("Email verified; returns tokens.", ref("AuthResponse")),
          400: apiError("Code invalid or expired (OTP_INVALID, OTP_EXPIRED)."),
          429: apiError("Too many wrong codes; request a new one (OTP_LOCKED)."),
        },
      },
    },
    "/auth/send-otp": {
      post: {
        summary: "Resend a verification code",
        tags: ["Auth"],
        description:
          "Always returns 200 so it cannot be used to discover accounts. At most one email per minute.",
        requestBody: jsonRequest({
          type: "object",
          properties: { email: { type: "string", format: "email" } },
          required: ["email"],
        }),
        responses: {
          200: successMessage("A code was sent if an unverified account exists."),
          429: apiError("Too many requests (RATE_LIMITED)."),
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Log in",
        tags: ["Auth"],
        parameters: [{ $ref: "#/components/parameters/ClientType" }],
        requestBody: jsonRequest({
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password" },
          },
          required: ["email", "password"],
        }),
        responses: {
          200: jsonResponse("Login successful; returns tokens.", ref("AuthResponse")),
          401: apiError("Email or password is incorrect (INVALID_CREDENTIALS)."),
          403: apiError("Email not verified; a new code was emailed (EMAIL_NOT_VERIFIED)."),
          429: apiError("Too many attempts (RATE_LIMITED)."),
        },
      },
    },
    "/auth/refresh": {
      post: {
        summary: "Exchange a refresh token for a new token pair",
        tags: ["Auth"],
        description:
          "Browsers send the httpOnly cookie automatically (use `credentials: include`). Mobile apps send `refreshToken` in the body. The old refresh token stops working.",
        parameters: [{ $ref: "#/components/parameters/ClientType" }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { refreshToken: { type: "string", description: "Mobile only." } },
              },
            },
          },
        },
        responses: {
          200: jsonResponse("New tokens.", ref("AuthResponse")),
          401: apiError("Refresh token missing, invalid, expired or revoked (REFRESH_*). Log in again."),
          403: apiError("Request origin is not allowed (ORIGIN_NOT_ALLOWED)."),
        },
      },
    },
    "/auth/logout": {
      post: {
        summary: "Log out of this device",
        tags: ["Auth"],
        description: "Revokes the refresh token (cookie or mobile body) and clears the cookie.",
        parameters: [{ $ref: "#/components/parameters/ClientType" }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { refreshToken: { type: "string", description: "Mobile only." } },
              },
            },
          },
        },
        responses: { 200: successMessage("Logged out.") },
      },
    },
    "/auth/logout-all": {
      post: {
        ...protectedOperation("Log out of every device", ["Auth"], {
          200: successMessage("All sessions revoked and sockets disconnected."),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/auth/forgot-password": {
      post: {
        summary: "Request a password reset email",
        tags: ["Auth"],
        description:
          "Always returns 200 so it cannot be used to discover accounts. Mobile clients get a link to MOBILE_PASSWORD_RESET_URL when configured.",
        parameters: [{ $ref: "#/components/parameters/ClientType" }],
        requestBody: jsonRequest({
          type: "object",
          properties: { email: { type: "string", format: "email" } },
          required: ["email"],
        }),
        responses: {
          200: successMessage("A reset link was sent if the account exists."),
          429: apiError("Too many requests (RATE_LIMITED)."),
          502: apiError("Email could not be sent (EMAIL_FAILED)."),
        },
      },
    },
    "/auth/reset-password": {
      post: {
        summary: "Reset password using a reset token",
        tags: ["Auth"],
        description: "Signs out every device, then returns tokens for this one.",
        parameters: [{ $ref: "#/components/parameters/ClientType" }],
        requestBody: jsonRequest({
          type: "object",
          properties: {
            token: { type: "string" },
            password: { type: "string", format: "password", minLength: 8 },
            passwordConfirm: { type: "string", format: "password" },
          },
          required: ["token", "password"],
        }),
        responses: {
          200: jsonResponse("Password reset; returns tokens.", ref("AuthResponse")),
          400: apiError("Token invalid/expired, weak password or mismatch."),
        },
      },
    },
    "/auth/change-password": {
      post: {
        ...protectedOperation(
          "Change password",
          ["Auth"],
          {
            200: jsonResponse("Password changed; other devices signed out.", ref("AuthResponse")),
            400: apiError("Weak or unchanged password."),
            401: apiError("Current password incorrect or not authenticated."),
          },
          {
            parameters: [{ $ref: "#/components/parameters/ClientType" }],
            requestBody: jsonRequest({
              type: "object",
              properties: {
                currentPassword: { type: "string", format: "password" },
                newPassword: { type: "string", format: "password", minLength: 8 },
              },
              required: ["currentPassword", "newPassword"],
            }),
          }
        ),
      },
    },
    "/user/get-me": {
      get: {
        ...protectedOperation("Get the current user's profile", ["User"], {
          200: jsonResponse("Current user profile.", ref("UserResponse")),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/update-me": {
      patch: {
        ...protectedOperation("Update the current user's profile", ["User"], {
          200: jsonResponse("Profile updated.", ref("UserResponse")),
          401: apiError("Authentication is required."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              about: { type: "string" },
              avatar: { type: "string" },
            },
            additionalProperties: false,
          }),
        }),
      },
    },
    "/user/get-users": {
      get: {
        ...protectedOperation(
          "List verified users who are not already friends",
          ["User"],
          {
            200: jsonResponse("Users found.", ref("UserListResponse")),
            401: apiError("Authentication is required."),
          }
        ),
      },
    },
    "/user/get-all-verified-users": {
      get: {
        ...protectedOperation("List other verified users", ["User"], {
          200: jsonResponse("Users found.", ref("UserListResponse")),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/get-requests": {
      get: {
        ...protectedOperation("List incoming friend requests", ["User"], {
          200: jsonResponse(
            "Friend requests found.",
            ref("FriendRequestListResponse")
          ),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/get-friends": {
      get: {
        ...protectedOperation("List the current user's friends", ["User"], {
          200: jsonResponse("Friends found.", ref("UserListResponse")),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/chat-attachment-upload-url": {
      post: {
        ...protectedOperation("Request a chat attachment upload URL", ["User"], {
          200: jsonResponse("Upload URL created.", ref("UploadUrlResponse")),
          400: apiError("Invalid file metadata or file exceeds 25 MB."),
          401: apiError("Authentication is required."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: {
              fileName: { type: "string" },
              contentType: { type: "string" },
              contentLength: {
                type: "integer",
                minimum: 1,
                maximum: 26214400,
                description: "File size in bytes; maximum 25 MB.",
              },
            },
            required: ["fileName", "contentType", "contentLength"],
          }),
        }),
      },
    },
    "/user/avatar-upload-url": {
      post: {
        ...protectedOperation("Request a profile image upload URL", ["User"], {
          200: jsonResponse("Upload URL created.", ref("UploadUrlResponse")),
          400: apiError("Unsupported image type or image exceeds 3 MB."),
          401: apiError("Authentication is required."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: {
              fileName: { type: "string" },
              contentType: {
                type: "string",
                enum: ["image/gif", "image/jpeg", "image/png", "image/webp"],
              },
              contentLength: {
                type: "integer",
                minimum: 1,
                maximum: 3145728,
                description: "Image size in bytes; maximum 3 MB.",
              },
            },
            required: ["fileName", "contentType", "contentLength"],
          }),
        }),
      },
    },
    "/user/chat-attachment-download-url": {
      post: {
        ...protectedOperation("Request an authorized attachment download URL", ["User"], {
          200: jsonResponse("Download URL created.", {
            type: "object",
            properties: {
              status: { type: "string", example: "success" },
              data: {
                type: "object",
                properties: { url: { type: "string", format: "uri" } },
                required: ["url"],
              },
            },
            required: ["status", "data"],
          }),
          401: apiError("Authentication is required."),
          404: apiError("Attachment is not found or is not accessible."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: {
              conversationId: { type: "string" },
              key: { type: "string", description: "Private chat object key." },
            },
            required: ["conversationId", "key"],
          }),
        }),
      },
    },
    "/user/call-provider": {
      get: {
        ...protectedOperation("Get the configured call provider", ["Call"], {
          200: jsonResponse("Configured call provider.", ref("CallProviderResponse")),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/call-credentials": {
      post: {
        ...protectedOperation("Get credentials for an active call", ["Call"], {
          200: jsonResponse("Call-scoped provider credentials.", ref("CallCredentialsResponse")),
          400: apiError("Call ID is invalid."),
          401: apiError("Authentication is required."),
          404: apiError("Call is inactive or the user is not a participant."),
          503: apiError("Call provider is not configured."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: { callId: { type: "string" } },
            required: ["callId"],
          }),
        }),
      },
    },
    "/user/blocked": {
      get: {
        ...protectedOperation("List users you have blocked", ["User"], {
          200: successMessage("Blocked users (data: array of users)."),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/block": {
      post: {
        ...protectedOperation(
          "Block a user",
          ["User"],
          {
            200: successMessage("User blocked. Messages, requests and calls are refused both ways."),
            400: apiError("Invalid user."),
            401: apiError("Authentication is required."),
            404: apiError("User not found."),
          },
          { requestBody: jsonRequest({
            type: "object",
            properties: { userId: { type: "string" } },
            required: ["userId"],
          }) }
        ),
      },
    },
    "/user/unblock": {
      post: {
        ...protectedOperation(
          "Unblock a user",
          ["User"],
          {
            200: successMessage("User unblocked."),
            400: apiError("Invalid user."),
            401: apiError("Authentication is required."),
          },
          { requestBody: jsonRequest({
            type: "object",
            properties: { userId: { type: "string" } },
            required: ["userId"],
          }) }
        ),
      },
    },
    "/user/settings": {
      patch: {
        ...protectedOperation(
          "Update notification and chat settings",
          ["User"],
          {
            200: successMessage("Settings saved (data: settings)."),
            400: apiError("Nothing to update or invalid value."),
            401: apiError("Authentication is required."),
          },
          {
            requestBody: jsonRequest({
              type: "object",
              properties: {
                notifications: {
                  type: "object",
                  properties: {
                    messages: { type: "boolean" },
                    groups: { type: "boolean" },
                    calls: { type: "boolean" },
                    preview: { type: "boolean" },
                    sound: { type: "boolean" },
                  },
                },
                wallpaper: { type: "string", enum: ["default", "plain", "sky", "mint", "sand", "rose", "night"] },
              },
            }),
          }
        ),
      },
    },
    "/user/export": {
      get: {
        ...protectedOperation("Download all of your data as JSON", ["User"], {
          200: { description: "JSON file attachment with profile, friends, sent messages, groups and calls." },
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/notifications": {
      get: {
        ...protectedOperation(
          "List notification-centre entries",
          ["Notifications"],
          {
            200: jsonResponse("Newest first, with the unread count.", {
              type: "object",
              properties: {
                status: { type: "string" },
                data: {
                  type: "object",
                  properties: {
                    unread: { type: "integer" },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          _id: { type: "string" },
                          type: { type: "string", enum: ["friend_request", "request_accepted", "missed_call", "group_added"] },
                          title: { type: "string" },
                          body: { type: "string" },
                          data: { type: "object" },
                          read: { type: "boolean" },
                          createdAt: { type: "string", format: "date-time" },
                          actor: { type: "object" },
                        },
                      },
                    },
                  },
                },
              },
            }),
            401: apiError("Authentication is required."),
          },
          { parameters: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 100 } }] }
        ),
      },
    },
    "/user/notifications/read": {
      post: {
        ...protectedOperation(
          "Mark notifications read",
          ["Notifications"],
          { 200: successMessage("Marked read (data.unread is the new count)."), 401: apiError("Authentication is required.") },
          {
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Omit to mark all read." } } },
                },
              },
            },
          }
        ),
      },
    },
    "/user/notifications/clear": {
      post: {
        ...protectedOperation("Delete all notifications", ["Notifications"], {
          200: successMessage("Notifications cleared."),
          401: apiError("Authentication is required."),
        }),
      },
    },
    "/user/push/public-key": {
      get: {
        ...protectedOperation("Get the VAPID public key for Web Push", ["Notifications"], {
          200: successMessage("data.publicKey: base64url VAPID public key."),
          401: apiError("Authentication is required."),
          503: apiError("Push is not configured (PUSH_NOT_CONFIGURED)."),
        }),
      },
    },
    "/user/push/subscribe": {
      post: {
        ...protectedOperation(
          "Register this browser for push notifications",
          ["Notifications"],
          { 200: successMessage("Subscribed."), 400: apiError("Invalid subscription."), 401: apiError("Authentication is required.") },
          {
            requestBody: jsonRequest({
              type: "object",
              properties: {
                subscription: {
                  type: "object",
                  description: "PushSubscription.toJSON() from the browser.",
                  properties: {
                    endpoint: { type: "string" },
                    keys: { type: "object", properties: { p256dh: { type: "string" }, auth: { type: "string" } } },
                  },
                },
              },
              required: ["subscription"],
            }),
          }
        ),
      },
    },
    "/user/push/unsubscribe": {
      post: {
        ...protectedOperation(
          "Stop push notifications on this browser",
          ["Notifications"],
          { 200: successMessage("Unsubscribed."), 401: apiError("Authentication is required.") },
          { requestBody: jsonRequest({ type: "object", properties: { endpoint: { type: "string" } }, required: ["endpoint"] }) }
        ),
      },
    },
    "/user/start-audio-call": {
      post: {
        ...protectedOperation("Start an audio call with a friend", ["Call"], {
          200: jsonResponse("Audio call started.", ref("CallStartResponse")),
          400: apiError("Recipient ID is invalid."),
          401: apiError("Authentication is required."),
          403: apiError("Calls are only allowed between friends."),
          404: apiError("Call participant was not found."),
          503: apiError("Call provider is not configured."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: { id: { type: "string", description: "Recipient user ID." } },
            required: ["id"],
          }),
        }),
      },
    },
    "/user/start-video-call": {
      post: {
        ...protectedOperation("Start a video call with a friend", ["Call"], {
          200: jsonResponse("Video call started.", ref("CallStartResponse")),
          400: apiError("Recipient ID is invalid."),
          401: apiError("Authentication is required."),
          403: apiError("Calls are only allowed between friends."),
          404: apiError("Call participant was not found."),
          503: apiError("Call provider is not configured."),
        }, {
          requestBody: jsonRequest({
            type: "object",
            properties: { id: { type: "string", description: "Recipient user ID." } },
            required: ["id"],
          }),
        }),
      },
    },
    "/user/get-call-logs": {
      get: {
        ...protectedOperation("Get the current user's call history", ["Call"], {
          200: jsonResponse("Call logs found.", ref("CallLogsResponse")),
          401: apiError("Authentication is required."),
        }),
      },
    },
  },
};
