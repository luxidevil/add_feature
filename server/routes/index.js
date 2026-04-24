const { Router } = require("express");
const healthRouter = require("./health");
const authRouter = require("./auth");
const adminRouter = require("./admin");
const userRouter = require("./user");
const proxyRouter = require("./proxy");
const testRouter = require("./test");
const gmailRouter = require("./gmail");
const nfLoginRouter = require("./nf-login");
const crRouter = require("./cr");
const payRouter = require("./pay");

const router = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(testRouter);
router.use("/gmail", gmailRouter);
router.use("/nf", nfLoginRouter);
router.use(payRouter);
router.use(adminRouter);
router.use(userRouter);
router.use(proxyRouter);
router.use(crRouter);

module.exports = router;
