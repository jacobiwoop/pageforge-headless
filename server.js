const express = require("express");
const cors = require("cors");
const multer = require("multer");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3005;

// -----------------------------
// Multer: réception de fichiers
// -----------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/javascript" ||
      file.mimetype === "text/javascript" ||
      file.originalname.endsWith(".js")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Seuls les fichiers .js sont acceptés"));
    }
  },
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// -----------------------------
// Browser singleton (réutilisé)
// -----------------------------
let BROWSER = null;
async function getBrowser() {
  if (BROWSER) return BROWSER;
  BROWSER = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
    // Render fournit souvent CHROME_PATH via Puppeteer install
    executablePath: process.env.CHROME_PATH || undefined,
    defaultViewport: { width: 1280, height: 900 },
  });
  BROWSER.on("disconnected", () => {
    BROWSER = null;
  });
  return BROWSER;
}

// Helper: créer un contexte/page optimisé
async function withPage(run, { locale = "en-US", userAgent, viewport } = {}) {
  const browser = await getBrowser();
  let page;
  try {
    page = await browser.newPage();

    // UA & langue
    await page.setUserAgent(
      userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language":
        locale === "fr-FR" ? "fr-FR,fr;q=0.9" : "en-US,en;q=0.9",
    });
    if (viewport) await page.setViewport(viewport);

    // Blocage ressources lourdes pour accélérer
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      const url = req.url();
      if (type === "image" || type === "media" || type === "font")
        return req.abort();
      if (
        /(google-analytics|doubleclick|googletagmanager|facebook|ads|beacon)/i.test(
          url,
        )
      )
        return req.abort();
      return req.continue();
    });

    // Timeouts par défaut plus courts
    page.setDefaultTimeout(5000);

    return await run(page, null);
  } finally {
    // Fermer la page si ouverte
    if (page) await page.close().catch(() => {});
  }
}

// -----------------------------
// Routes basiques
// -----------------------------
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Headless Browser API (Puppeteer)",
    endpoints: [
      {
        path: "/run",
        method: "POST",
        description: "Exécuter un script (JSON)",
      },
      {
        path: "/run-file",
        method: "POST",
        description: "Exécuter un fichier .js",
      },
      { path: "/health", method: "GET", description: "Vérifier le statut" },
    ],
  });
});

app.get("/health", async (req, res) => {
  try {
    await getBrowser();
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: "error", error: { message: e.message } });
  }
});

// ------------------------------------
// POST /run : exécution depuis JSON
// ------------------------------------
app.post("/run", async (req, res) => {
  const { script, timeout = 60000 } = req.body || {};
  if (!script) {
    return res
      .status(400)
      .json({
        status: "error",
        error: { message: 'Le champ "script" est requis' },
      });
  }
  await executeScript(script, timeout, res);
});

// ------------------------------------
// POST /run-file : exécution d'un .js
// ------------------------------------
app.post("/run-file", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      status: "error",
      error: {
        message:
          'Aucun fichier reçu. Utilisez le champ "file" pour envoyer un .js',
      },
    });
  }
  const script = req.file.buffer.toString("utf-8");
  const timeout = parseInt(req.body.timeout) || 60000;
  await executeScript(script, timeout, res);
});

// ------------------------------------
// Exécution commune avec réutilisation
// ------------------------------------
async function executeScript(script, timeout, res) {
  try {
    const data = await withPage(async (page, context) => {
      // Exécuter le script utilisateur (AsyncFunction)
      const AsyncFunction = Object.getPrototypeOf(
        async function () {},
      ).constructor;
      const userFunction = new AsyncFunction("page", "context", script);

      // Course avec timeout
      const result = await Promise.race([
        userFunction(page, context),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("Timeout dépassé")), timeout),
        ),
      ]);

      return result;
    });

    res.json({
      status: "success",
      data: data || { message: "Script exécuté avec succès" },
    });
  } catch (error) {
    console.error("Erreur:", error);
    res
      .status(500)
      .json({ status: "error", error: { message: error.message } });
  }
}

// ------------------------------------
// Gestion des erreurs globales
// ------------------------------------
app.use((err, req, res, next) => {
  console.error("Erreur non gérée:", err);
  res
    .status(500)
    .json({ status: "error", error: { message: "Erreur interne du serveur" } });
});

// ------------------------------------
// Démarrage du serveur
// ------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🚀 Service Headless Browser (Puppeteer) démarré sur le port ${PORT}`,
  );
  console.log(`📡 Endpoint principal: POST /run`);
});

// Fermeture propre
process.on("SIGTERM", async () => {
  if (BROWSER) {
    try {
      await BROWSER.close();
    } catch (_) {}
  }
  process.exit(0);
});
process.on("SIGINT", async () => {
  if (BROWSER) {
    try {
      await BROWSER.close();
    } catch (_) {}
  }
  process.exit(0);
});
