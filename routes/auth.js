const router = require("express").Router();

const authController = require("../controllers/authController");
const {
  emailLimiter,
  loginLimiter,
  refreshLimiter,
  verifyLimiter,
} = require("../utils/rateLimiters");

router.post("/register", emailLimiter, authController.register);
router.post("/verify", verifyLimiter, authController.verifyOTP);
router.post("/send-otp", emailLimiter, authController.sendOTP);

router.post("/login", loginLimiter, authController.login);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.post("/logout-all", authController.protect, authController.logoutAll);

router.post("/forgot-password", emailLimiter, authController.forgotPassword);
router.post("/reset-password", verifyLimiter, authController.resetPassword);
router.post("/change-password", authController.protect, authController.changePassword);

module.exports = router;
