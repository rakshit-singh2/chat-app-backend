const router = require("express").Router();

const userController = require("../controllers/userController");
const authController = require("../controllers/authController");

router.get("/call-provider", authController.protect, userController.getCallProvider);
router.post(
  "/call-credentials",
  authController.protect,
  userController.getCallCredentials
);
router.get("/get-call-logs", authController.protect, userController.getCallLogs);
router.get("/get-me", authController.protect, userController.getMe);
router.post(
  "/chat-attachment-upload-url",
  authController.protect,
  userController.createChatAttachmentUploadUrl
);
router.post(
  "/avatar-upload-url",
  authController.protect,
  userController.createAvatarUploadUrl
);
router.post(
  "/chat-attachment-download-url",
  authController.protect,
  userController.createChatAttachmentDownloadUrl
);
router.patch("/update-me", authController.protect, userController.updateMe);
router.get("/get-all-verified-users", authController.protect, userController.getAllVerifiedUsers);
router.get("/get-users", authController.protect, userController.getUsers);
router.get("/get-requests", authController.protect, userController.getRequests);
router.get("/get-friends", authController.protect, userController.getFriends);

router.get("/blocked", authController.protect, userController.getBlocked);
router.post("/block", authController.protect, userController.blockUser);
router.post("/unblock", authController.protect, userController.unblockUser);
router.patch("/settings", authController.protect, userController.updateSettings);
router.get("/export", authController.protect, userController.exportMyData);

router.get("/notifications", authController.protect, userController.getNotifications);
router.post("/notifications/read", authController.protect, userController.markNotificationsRead);
router.post("/notifications/clear", authController.protect, userController.clearNotifications);
router.get("/push/public-key", authController.protect, userController.getPushPublicKey);
router.post("/push/subscribe", authController.protect, userController.subscribePush);
router.post("/push/unsubscribe", authController.protect, userController.unsubscribePush);

router.post("/start-audio-call", authController.protect, userController.startAudioCall);
router.post("/start-video-call", authController.protect, userController.startVideoCall);


module.exports = router;
