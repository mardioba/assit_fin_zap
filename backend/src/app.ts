import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { categoriesRouter } from "./modules/categories/categories.routes.js";
import { accountsRouter } from "./modules/accounts/accounts.routes.js";
import { transactionsRouter } from "./modules/transactions/transactions.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { whatsappRouter } from "./modules/whatsapp/whatsapp.routes.js";
import { cardsRouter } from "./modules/cards/cards.routes.js";
import { recurringRouter } from "./modules/recurring/recurring.routes.js";
import { billsRouter } from "./modules/bills/bills.routes.js";

export function createApp(): express.Express {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => {
    // Corpo bruto para validação da assinatura HMAC do webhook (Meta).
    (req as { rawBody?: Buffer }).rawBody = buf;
  } }));
  app.use(cookieParser());

  // Limite global anti-abuso.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/whatsapp", whatsappRouter);
  app.use("/api/cards", cardsRouter);
  app.use("/api/recurring", recurringRouter);
  app.use("/api/bills", billsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
